import * as React from "react";

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorState } from "../src/components/MentionEditor";
import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import { createEventId } from "../src/services/eventId";
import { MentionEpisodeTracker } from "../src/domain/mentionEpisodes";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { serializeMentionMetadata } from "../src/domain/mentionMetadata";
import { resolveRecordContext, sameRecordContext } from "../src/domain/recordContext";
import type { MentionRecordContext } from "../src/domain/recordContext";
import type { UserSearchProvider } from "../src/domain/userSearch";

/** Accessible name used when the host supplies no column label. */
const FALLBACK_LABEL = "Ayonto Mention";

/**
 * One output of this control: the text and the mentions made in it, which are
 * two halves of a single editor state and are reconciled as one.
 */
interface OutputPair {
    readonly field: string;
    readonly metadata: string;
}

const EMPTY_PAIR: OutputPair = { field: "", metadata: "" };

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

    /**
     * What `getOutputs` reports: the text and the payload that belongs to it.
     *
     * Until this session changes the mentions, the payload is whatever the host
     * holds: a record is opened, not rewritten, and emitting an empty payload on
     * every form load would make the form dirty for nothing. From the first
     * change on, it is this session's own — including an empty set, which says
     * that the session now means to notify nobody.
     */
    private current: OutputPair = EMPTY_PAIR;
    /**
     * The pair that opened the current reconciliation cycle: the last one this
     * control actually accepted. It is the baseline a cycle is measured against
     * and is deliberately **not** touched by local edits, nor by a host report
     * that was classified as stale — a stale update must never become the new
     * baseline merely because `updateView` happened to see it.
     */
    private accepted: OutputPair = EMPTY_PAIR;
    /**
     * The most recent local output awaiting acknowledgement, or null when no
     * cycle is open.
     */
    private pending: OutputPair | null = null;
    /**
     * Every text this control emitted during the current cycle, the newest
     * included. The host may report any of them late, and each such report is an
     * echo of a value the user has already moved past.
     *
     * Texts, not pairs: the lineage answers one question — did this field value
     * come from us during this cycle — and the payload has no say in it.
     */
    private readonly emittedFieldsInCycle = new Set<string>();
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

        this.acceptPair({
            field: context.parameters.field.raw ?? "",
            metadata: context.parameters.mentionMetadata.raw ?? "",
        });
    }

    /**
     * Takes a pair as the truth and closes any cycle that was open: it becomes
     * the new baseline, nothing is outstanding, and the texts emitted during the
     * closed cycle are forgotten. Past this point the host may legitimately set
     * one of those values again.
     */
    private acceptPair(pair: OutputPair): void {
        this.current = pair;
        this.accepted = pair;
        this.pending = null;
        this.emittedFieldsInCycle.clear();
    }

    /**
     * Hands one output to the framework and keeps it outstanding until the host
     * reports exactly it back.
     */
    private emit(pair: OutputPair): void {
        this.current = pair;
        this.pending = pair;
        // The lineage grows; the cycle's baseline deliberately does not move.
        this.emittedFieldsInCycle.add(pair.field);
        this.notifyOutputChanged();
    }

    /**
     * Reconciles what the host reports against the output that may not have been
     * acknowledged yet.
     *
     * The framework does not tell a control whether an `updateView` carries the
     * result of its own last output or a value decided elsewhere, and it may
     * report any earlier value for a render or two after `notifyOutputChanged`.
     * It may also report the two halves of one output at different times: the
     * text of the newest one beside the payload of the one before it. A
     * reconciliation *cycle* therefore runs from the last pair this control
     * accepted until one of its own outputs is acknowledged **whole**, or the
     * host decides a text of its own. Five cases, in this order and with no
     * timers involved:
     *
     * 1. **Acknowledgement of the current output** — both halves match what is
     *    outstanding. The only thing that closes a cycle from the control's own
     *    side. Checked first, and first on purpose: an edit may legitimately
     *    return the text to the value the cycle started from while changing the
     *    payload, and that is an acknowledgement, not an echo.
     * 2. **An incomplete echo of the current text** — the right text with a
     *    payload that is not the one that belongs to it. The host is repeating
     *    one half of what it was given, and half an output is no news. It is
     *    dropped whole, and the cycle stays open however often it repeats: a
     *    payload the user has moved past must never come back because the text
     *    beside it happened to be current.
     * 3. **Stale pre-edit echo** — the text the cycle started from. The user has
     *    moved past it.
     * 4. **Stale earlier-output echo** — a text emitted earlier in this cycle.
     *    Typing "A" to "AB" to "ABC" leaves the host free to report "AB" late,
     *    and taking it would drag the text back a keystroke.
     * 5. **A genuinely external text** — anything else. It wins, even over an
     *    outstanding edit, because a business rule or another control may have
     *    set it deliberately, and it closes the cycle. Both halves come with it.
     *
     * The text decides all five. That rests on an assumption this architecture
     * makes explicit: **the companion column belongs to this control.** Nothing
     * else writes it, so a payload arriving on its own carries no decision, and
     * while an output is outstanding only a genuinely different text can
     * override the local state. What a stored payload says about who was
     * mentioned is never read: identity belongs to the session that wrote it.
     *
     * One ambiguity cannot be resolved without guessing: an external system may
     * deliberately choose a text identical to an earlier local output while a
     * newer one is still pending. Inside an open cycle that reading loses to
     * case 4, because silently dragging the text back a keystroke under the
     * user's hands is the worse failure. Once the cycle closes, the same value
     * is accepted normally.
     */
    private reconcile(host: OutputPair): void {
        const pending = this.pending;
        if (pending === null) {
            // No cycle open: the host is authoritative.
            this.acceptPair(host);
            return;
        }

        if (host.field === pending.field && host.metadata === pending.metadata) {
            // 1: the whole output came back.
            this.acceptPair(pending);
            return;
        }

        if (host.field === pending.field) {
            // 2: one half of it came back.
            return;
        }

        if (host.field === this.accepted.field) {
            // 3: the text this cycle started from.
            return;
        }

        if (this.emittedFieldsInCycle.has(host.field)) {
            // 4: a text from earlier in this cycle.
            return;
        }

        // 5: a genuinely external text closes the cycle.
        this.acceptPair(host);
    }

    /**
     * The payload for a set of mentions, or the one already held when this
     * control may not write the companion column at all.
     *
     * Where the host refuses the companion value, deriving one would replace
     * what is stored there with this session's own — and this session was never
     * allowed to make a mention in the first place. The episode tracker is left
     * untouched for the same reason: nothing happened that it should record.
     */
    private deriveMetadata(mentions: readonly MentionOccurrence[]): string {
        return this.mentionsAllowed
            ? serializeMentionMetadata(this.sourceField, this.episodes.update(mentions))
            : this.current.metadata;
    }

    /**
     * Takes one local edit: the text the user produced and the mentions standing
     * in it, as one state.
     *
     * Both halves are settled here before the framework is told anything, so a
     * `getOutputs` answered at that instant describes one moment of the editor
     * and not two. The framework is told exactly once per edit, and `updateView`
     * never calls it.
     */
    private readonly handleLocalEdit = (state: MentionEditorState): void => {
        this.emit({ field: state.text, metadata: this.deriveMetadata(state.mentions) });
    };

    /**
     * Takes the state a host value left behind.
     *
     * The text is already this control's own — it accepted it in `updateView` —
     * but a host value can take a mention out from under the editor, and then
     * the payload no longer describes the text it will be saved with. Saying so
     * is not a text change, and the framework is only told when the payload
     * actually moved. It is an output like any other: it stays outstanding until
     * the host reports it back, or the host would hand the old payload straight
     * back on its next update.
     */
    private readonly handleHostValueAdopted = (state: MentionEditorState): void => {
        const metadata = this.deriveMetadata(state.mentions);
        if (metadata === this.current.metadata) {
            return;
        }
        this.emit({ field: this.current.field, metadata });
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
        const host: OutputPair = {
            field: field.raw ?? "",
            metadata: metadata.raw ?? "",
        };

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
            this.acceptPair(host);
        } else {
            this.reconcile(host);
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
            value: this.current.field,
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
        return { field: this.current.field, mentionMetadata: this.current.metadata };
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
