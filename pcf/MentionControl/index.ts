import * as React from "react";

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorState } from "../src/components/MentionEditor";
import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import { createEventId } from "../src/services/eventId";
import { MentionEpisodeTracker } from "../src/domain/mentionEpisodes";
import { serializeMentionMetadata } from "../src/domain/mentionMetadata";
import { resolveRecordContext, sameRecordContext } from "../src/domain/recordContext";
import type { MentionRecordContext } from "../src/domain/recordContext";
import type { UserSearchProvider } from "../src/domain/userSearch";

/** Accessible name used when the host supplies no column label. */
const FALLBACK_LABEL = "Ayonto Mention";

/**
 * Gives every control instance its own ARIA ids, so two editors on one form
 * never point at the same listbox.
 *
 * `React.useId` is deliberately not used: it does not exist in React 16, which
 * is the version the Power Apps platform library provides.
 */
let instanceCount = 0;

/**
 * Power Apps component framework adapter for the Ayonto Mention control.
 *
 * Deliberately thin: it implements the framework lifecycle, owns the one piece
 * of state the framework forces on it — reconciling host values against local
 * edits — and delegates everything else to the React components under `src/`.
 *
 * It writes nothing to Dataverse. A mention becomes a notification by travelling
 * out with the record: the text and the mentions made in it are two bound
 * outputs of this control, they are saved by the same save, and a server-side
 * step turns the committed pair into notifications. A form that is discarded
 * commits neither, which is the whole point.
 */
export class MentionControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private userSearch: UserSearchProvider;
    private readonly listboxId: string;

    /** What the editor shows, and what `getOutputs` reports for the text column. */
    private value = "";
    /**
     * The host value that opened the current reconciliation cycle: the last one
     * this control actually accepted. It is the baseline a cycle is measured
     * against and is deliberately **not** touched by local edits, nor by a host
     * value that was classified as stale — a stale update must never become the
     * new baseline merely because `updateView` happened to see it.
     */
    private lastAcceptedHostValue = "";
    /**
     * The most recent local output awaiting acknowledgement, or null when no
     * cycle is open.
     */
    private pendingOutput: string | null = null;
    /**
     * Every local output emitted during the current cycle, the newest included.
     * The host may report any of them late, and each such report is an echo of a
     * value the user has already moved past.
     */
    private readonly emittedOutputsInCycle = new Set<string>();
    /**
     * The companion payload, exactly as `getOutputs` reports it.
     *
     * Until this session changes the mentions, it is whatever the host holds:
     * a record is opened, not rewritten, and emitting an empty payload on every
     * form load would make the form dirty for nothing. From the first change on,
     * it is this session's own — including an empty set, which says that the
     * session now means to notify nobody.
     */
    private metadata = "";
    /** The companion value this control last accepted from the host. */
    private lastAcceptedHostMetadata = "";
    /**
     * The record a mention would be written against, or null while there is
     * none. Re-resolved on every `updateView`, never frozen at init: on a form
     * for a new record the id only appears once Dataverse has saved it, and the
     * table or column configuration can change too.
     *
     * Nothing is written with it. It marks record boundaries, which is what
     * keeps one record's mention identities from following the editor to the
     * next, and it names the column the payload belongs to.
     */
    private recordContext: MentionRecordContext | null = null;
    /**
     * One notification per person for as long as that person stays mentioned.
     * Belongs to the record being edited and is emptied at a boundary.
     */
    private readonly episodes = new MentionEpisodeTracker(createEventId);
    /** The column the payload names. Read from the bound field's own metadata. */
    private sourceField = "";
    /**
     * False when the host will not let this control write the companion column
     * while the text itself is editable. A mention could then be made but never
     * recorded, so none may be made at all.
     */
    private mentionsAllowed = true;
    /**
     * Bumped when the editor moves to a different record, so React remounts it.
     *
     * The editor tracks which person each written mention means, and that cannot
     * be recovered from the text — "@Robin Fox" alone never says which Robin Fox.
     * Carrying it across records would attach one record's identities to another,
     * so the boundary is a remount rather than a reset method added to the editor
     * for the adapter's benefit.
     */
    private editorGeneration = 0;

    constructor() {
        instanceCount += 1;
        this.listboxId = `ayonto-mention-suggestions-${instanceCount.toString()}`;
    }

    /**
     * Initializes the control instance.
     * @param context Property bag provided by the framework.
     * @param notifyOutputChanged Callback used to signal new outputs.
     * @param state Session state for a single user.
     */
    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        // One service per control instance, over the framework's supported Web
        // API. It looks up people; nothing else here reads or writes Dataverse.
        this.userSearch = new DataverseUserSearchService(context.webAPI);

        this.acceptHostValue(
            context.parameters.field.raw ?? "",
            context.parameters.mentionMetadata.raw ?? ""
        );
    }

    /**
     * Takes a host value as the truth and closes any cycle that was open: it
     * becomes the new baseline, nothing is outstanding, and the outputs emitted
     * during the closed cycle are forgotten. Past this point the host may
     * legitimately set one of those values again.
     *
     * The companion payload travels with it. It is taken as a value to report
     * back unchanged, never read: what a stored payload says about who was
     * mentioned belongs to the session that wrote it, and reading identity out
     * of it would be the cross-session guessing this control does not do.
     */
    private acceptHostValue(hostValue: string, hostMetadata: string): void {
        this.value = hostValue;
        this.lastAcceptedHostValue = hostValue;
        this.metadata = hostMetadata;
        this.lastAcceptedHostMetadata = hostMetadata;
        this.pendingOutput = null;
        this.emittedOutputsInCycle.clear();
    }

    /**
     * Reconciles a value pushed by the host against the local outputs that may
     * not have been acknowledged yet.
     *
     * The framework does not tell a control whether an `updateView` carries the
     * result of its own last output or a value decided elsewhere, and it may
     * report any earlier value for a render or two after `notifyOutputChanged`.
     * A reconciliation *cycle* therefore runs from the last host value this
     * control accepted until one of its own outputs is acknowledged or the host
     * decides something of its own. Four cases are told apart, in this order and
     * with no timers involved:
     *
     * 1. **Acknowledgement of the current output** — checked first, and first on
     *    purpose: after editing "A" to "AB" and back to "A", a host reporting "A"
     *    acknowledges the current output rather than echoing the value the cycle
     *    started from.
     * 2. **Stale pre-edit echo** — the baseline the cycle started from. The user
     *    has moved past it.
     * 3. **Stale earlier-output echo** — any output emitted earlier in this
     *    cycle. Typing "A" to "AB" to "ABC" leaves the host free to report "AB"
     *    late, and taking it would drag the text back a keystroke.
     * 4. **A genuinely external value** — anything else. It wins, even over an
     *    outstanding edit, because a business rule or another control may have
     *    set it deliberately, and it closes the cycle.
     *
     * The text decides all four. The companion payload is written only by this
     * control, so a host report of it carries no decision of its own: it is
     * adopted exactly when the text it arrived with is, and ignored exactly when
     * that text is. An echo of the payload can therefore never roll back a newer
     * local one.
     *
     * One ambiguity cannot be resolved without guessing: an external system may
     * deliberately choose a value identical to an earlier local output while a
     * newer one is still pending. Inside an open cycle that reading loses to
     * case 3, because silently dragging the text back a keystroke under the
     * user's hands is the worse failure. Once the cycle closes, the same value
     * is accepted normally.
     */
    private reconcile(hostValue: string, hostMetadata: string): void {
        if (this.pendingOutput === null) {
            // No cycle open: the host is authoritative.
            this.acceptHostValue(hostValue, hostMetadata);
            return;
        }

        if (hostValue === this.pendingOutput) {
            // 1: acknowledgement of the current output. What comes back with it
            // is this control's own payload, so accepting it changes nothing.
            this.acceptHostValue(hostValue, this.metadata);
            return;
        }

        if (hostValue === this.lastAcceptedHostValue) {
            // 2: the value this cycle started from.
            return;
        }

        if (this.emittedOutputsInCycle.has(hostValue)) {
            // 3: an output from earlier in this cycle.
            return;
        }

        // 4: a genuinely external value closes the cycle.
        this.acceptHostValue(hostValue, hostMetadata);
    }

    /**
     * Takes one local edit: the text the user produced and the mentions standing
     * in it, as one state.
     *
     * Both outputs are settled here before the framework is told anything, so a
     * `getOutputs` answered at that instant describes one moment of the editor
     * and not two. The framework is told exactly once per edit, and `updateView`
     * never calls it.
     */
    private readonly handleLocalEdit = (state: MentionEditorState): void => {
        this.value = state.text;
        this.pendingOutput = state.text;
        // The lineage grows; the cycle's baseline deliberately does not move.
        this.emittedOutputsInCycle.add(state.text);
        this.metadata = serializeMentionMetadata(
            this.sourceField,
            this.episodes.update(state.mentions)
        );
        this.notifyOutputChanged();
    };

    /**
     * Takes the state a host value left behind.
     *
     * The text is already this control's own — it accepted it in `updateView` —
     * but a host value can take a mention out from under the editor, and then
     * the payload no longer describes the text it will be saved with. Saying so
     * is not a text change, and the framework is only told when the payload
     * actually moved.
     */
    private readonly handleHostValueAdopted = (state: MentionEditorState): void => {
        const next = serializeMentionMetadata(
            this.sourceField,
            this.episodes.update(state.mentions)
        );
        if (next === this.metadata) {
            return;
        }
        this.metadata = next;
        this.notifyOutputChanged();
    };

    /**
     * Moves the editor to the record the host now reports, and says whether that
     * crossed a real record boundary.
     *
     * Going from "no id yet" to a real id is **not** a boundary: that is the same
     * editing session finally becoming persistable, and the mentions already
     * made in it must survive to be saved with the record — with the identifiers
     * they were given before the save. Anything else — another record, another
     * table, another column, or losing the context entirely — is a boundary, and
     * nothing from the old scope may follow.
     *
     * The answer is returned rather than recomputed by the caller, so the rule
     * for what counts as a boundary lives in exactly one place.
     */
    private applyRecordContext(next: MentionRecordContext | null): boolean {
        const previous = this.recordContext;
        this.recordContext = next;

        const crossedBoundary = previous !== null && !sameRecordContext(previous, next);
        if (crossedBoundary) {
            this.episodes.reset();
            this.editorGeneration += 1;
        }

        return crossedBoundary;
    }

    /**
     * Called whenever a value in the property bag changes.
     * @param context Property bag provided by the framework.
     * @returns The root React element for the control.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const field = context.parameters.field;
        const metadata = context.parameters.mentionMetadata;
        const hostValue = field.raw ?? "";
        const hostMetadata = metadata.raw ?? "";

        // The column the payload names comes from the bound field's own metadata,
        // which the framework documents and types, so the maker does not have to
        // configure it and no host internals are touched.
        this.sourceField = (field.attributes?.LogicalName ?? "").trim().toLowerCase();

        // Which record this is gets settled first, because it decides how the
        // value is to be read.
        const crossedBoundary = this.applyRecordContext(
            resolveRecordContext({
                recordId: context.parameters.recordId.raw,
                recordTable: context.parameters.recordTable.raw,
                sourceField: field.attributes?.LogicalName,
            })
        );

        if (crossedBoundary) {
            // A different record's value is simply the truth, and it has to be
            // taken as such before anything compares it to the record just left.
            // Judged against the old lineage it could look like a stale echo of
            // that record's baseline, or of something it emitted, and this
            // control would carry the previous record's text into this one.
            // Accepting it also ends the old reconciliation cycle outright:
            // pending output, emitted lineage and baseline all belong to a record
            // that is no longer open. The payload of the record now open comes
            // with it, and this session has made no mentions on it yet.
            this.acceptHostValue(hostValue, hostMetadata);
        } else {
            this.reconcile(hostValue, hostMetadata);
        }

        // A column the user may not write to is read-only even when the form as a
        // whole is editable.
        const disabled = context.mode.isControlDisabled || field.security?.editable === false;
        // A mention has to be recorded somewhere to mean anything later. Where
        // the host will not accept the companion value, the safe answer is to
        // offer nobody rather than to create an identity that is silently lost.
        this.mentionsAllowed = metadata.security?.editable !== false;
        const hostLabel = context.mode.label;

        return React.createElement(MentionEditor, {
            // Changing on a record boundary, so React remounts the editor and its
            // mention identities start empty for the new record.
            key: `mention-editor-${this.editorGeneration.toString()}`,
            value: this.value,
            disabled,
            canMention: this.mentionsAllowed,
            maxLength: field.attributes?.MaxLength,
            label: hostLabel.trim().length > 0 ? hostLabel : FALLBACK_LABEL,
            listboxId: this.listboxId,
            userSearchProvider: this.userSearch,
            onLocalEdit: this.handleLocalEdit,
            onHostValueAdopted: this.handleHostValueAdopted,
        });
    }

    /**
     * @returns The outputs defined as "bound" or "output" in the manifest.
     *
     * Both describe the same moment of the editor: they are set together, by the
     * same local edit, before the framework is ever told there is something new.
     */
    public getOutputs(): IOutputs {
        return { field: this.value, mentionMetadata: this.metadata };
    }

    /**
     * Called when the control is removed from the DOM tree.
     *
     * Nothing to tear down. Mentions made in this session live in the outputs
     * this control has already handed to the form; whether they become
     * notifications is decided by whether the record is saved, which is not this
     * control's to know and no longer its to guess.
     */
    public destroy(): void {
        this.episodes.reset();
    }
}
