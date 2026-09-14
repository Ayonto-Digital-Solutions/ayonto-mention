import * as React from "react";

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import { DataverseMentionRepository } from "../src/services/dataverseMentionRepository";
import { MentionGracePeriod } from "../src/services/mentionGracePeriod";
import { resolveRecordContext, sameRecordContext } from "../src/domain/recordContext";
import type { MentionRecordContext } from "../src/domain/recordContext";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import type { MentionRepository } from "../src/domain/mentionPersistence";
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
 */
export class MentionControl implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private userSearch: UserSearchProvider;
    private readonly listboxId: string;

    /** What the editor shows, and what `getOutputs` reports. */
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
     * The record a mention would be written against, or null while it cannot be
     * written against yet. Re-resolved on every `updateView`, never frozen at
     * init: on a form for a new record the id only appears once Dataverse has
     * saved it, and the table or column configuration can change too.
     *
     * Nothing is written with it yet; the persistence step will read this field
     * directly, so it stays private and the class exposes no accessor for it.
     */
    private recordContext: MentionRecordContext | null = null;
    /** Writes the mention rows. Held behind the contract, not the Dataverse class. */
    private repository: MentionRepository;
    /**
     * The grace period for the record currently being edited, or null while the
     * record cannot be written against. Replaced, never reused, when the editor
     * moves to another record.
     */
    private grace: MentionGracePeriod | null = null;
    /** The mentions standing in the text, as the editor last reported them. */
    private writtenMentions: readonly MentionOccurrence[] = [];
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
        // One service per control instance, over the framework's supported Web API.
        this.userSearch = new DataverseUserSearchService(context.webAPI);
        this.repository = new DataverseMentionRepository(context.webAPI);

        this.acceptHostValue(context.parameters.field.raw ?? "");
    }

    /**
     * Takes a host value as the truth and closes any cycle that was open: it
     * becomes the new baseline, nothing is outstanding, and the outputs emitted
     * during the closed cycle are forgotten. Past this point the host may
     * legitimately set one of those values again.
     */
    private acceptHostValue(hostValue: string): void {
        this.value = hostValue;
        this.lastAcceptedHostValue = hostValue;
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
     * One ambiguity cannot be resolved without guessing: an external system may
     * deliberately choose a value identical to an earlier local output while a
     * newer one is still pending. Inside an open cycle that reading loses to
     * case 3, because silently dragging the text back a keystroke under the
     * user's hands is the worse failure. Once the cycle closes, the same value
     * is accepted normally.
     */
    private reconcile(hostValue: string): void {
        if (this.pendingOutput === null) {
            // No cycle open: the host is authoritative.
            this.acceptHostValue(hostValue);
            return;
        }

        if (hostValue === this.pendingOutput) {
            // 1: acknowledgement of the current output.
            this.acceptHostValue(hostValue);
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
        this.acceptHostValue(hostValue);
    }

    /**
     * Takes a local edit. The framework is told exactly once per edit, and
     * `updateView` never calls it.
     */
    private readonly handleChange = (next: string): void => {
        this.value = next;
        this.pendingOutput = next;
        // The lineage grows; the cycle's baseline deliberately does not move.
        this.emittedOutputsInCycle.add(next);
        this.notifyOutputChanged();
    };

    /**
     * Moves the editor to the record the host now reports, and says whether that
     * crossed a real record boundary.
     *
     * Going from "no id yet" to a real id is **not** a boundary: that is the same
     * editing session finally becoming persistable, and the mentions already
     * selected in it must survive to be written. Anything else — another record,
     * another table, another column, or losing the context entirely — is a
     * boundary, and nothing from the old scope may follow.
     *
     * The answer is returned rather than recomputed by the caller, so the rule
     * for what counts as a boundary lives in exactly one place.
     */
    private applyRecordContext(next: MentionRecordContext | null): boolean {
        const previous = this.recordContext;
        this.recordContext = next;

        const crossedBoundary = previous !== null && !sameRecordContext(previous, next);
        if (crossedBoundary) {
            this.closePersistence();
            this.editorGeneration += 1;
        }

        if (next !== null && this.grace === null) {
            this.startPersistence(next);
        }

        return crossedBoundary;
    }

    /**
     * Opens a persistence scope for one record.
     *
     * The context is copied into the scope and every write from this scheduler
     * uses that copy. Reading `this.recordContext` when the timer fires five
     * seconds later would write the mention against whichever record the form had
     * moved to by then.
     */
    private startPersistence(scope: MentionRecordContext): void {
        const captured: MentionRecordContext = {
            recordId: scope.recordId,
            recordTable: scope.recordTable,
            sourceField: scope.sourceField,
        };

        const grace = new MentionGracePeriod(async (mention: MentionOccurrence) => {
            await this.repository.create({
                context: captured,
                recipient:
                    mention.email === undefined
                        ? { userId: mention.userId, name: mention.name }
                        : { userId: mention.userId, name: mention.name, email: mention.email },
            });
        });
        this.grace = grace;

        // Mentions picked before the record had an id are now persistable, and
        // each gets the full grace period from this moment. Ones removed in the
        // meantime are not in the snapshot and are never written.
        grace.updateWritten(this.writtenMentions);
        for (const mention of this.writtenMentions) {
            this.consumeScheduleResult(grace.schedule(mention));
        }
    }

    /** Keeps the editor's view of the text and the grace period in step. */
    private readonly handleWrittenMentionsChange = (
        mentions: readonly MentionOccurrence[]
    ): void => {
        this.writtenMentions = mentions;
        this.grace?.updateWritten(mentions);
    };

    /**
     * Starts the grace period for a mention that was just written.
     *
     * Nothing is written to Dataverse here, and the delay is never bypassed. With
     * no persistable record there is nothing to schedule against; the editor keeps
     * the identity, and the mention is scheduled once the record gets its id.
     */
    private readonly handleMentionSelected = (mention: MentionOccurrence): void => {
        const grace = this.grace;
        if (grace === null) {
            return;
        }
        this.consumeScheduleResult(grace.schedule(mention));
    };

    /**
     * Takes the result of a detached schedule.
     *
     * A rejection here is already a neutral MentionRepositoryError, and there is
     * nowhere to show it yet: telling the user that a mention could not be saved
     * is a separate step. Until then the rejection is consumed so it cannot become
     * an unhandled rejection, and deliberately not logged — a Dataverse failure
     * can carry the environment URL and schema names with it. This is a temporary
     * boundary, not an intention to ignore persistence failures.
     */
    private consumeScheduleResult(pending: Promise<void>): void {
        void pending.catch(() => undefined);
    }

    /**
     * Ends the current persistence scope.
     *
     * Cancelling is done by reporting an empty set, which is exactly what the
     * grace period treats as a withdrawal: anything still waiting is dropped
     * rather than flushed onto a record it was never meant for.
     *
     * There may be no scope at all — a record that never received an id never
     * opened one, so a form abandoned before its first save has nothing to tear
     * down.
     */
    private closePersistence(): void {
        this.grace?.updateWritten([]);
        this.grace = null;
        this.writtenMentions = [];
    }

    /**
     * Called whenever a value in the property bag changes.
     * @param context Property bag provided by the framework.
     * @returns The root React element for the control.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const field = context.parameters.field;
        const hostValue = field.raw ?? "";

        // Which record this is gets settled first, because it decides how the
        // value is to be read. The column name comes from the bound field's own
        // metadata, which the framework documents and types, so the maker does
        // not have to configure it and no host internals are touched.
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
            // that is no longer open.
            this.acceptHostValue(hostValue);
        } else {
            this.reconcile(hostValue);
        }

        // A column the user may not write to is read-only even when the form as a
        // whole is editable.
        const disabled = context.mode.isControlDisabled || field.security?.editable === false;
        const hostLabel = context.mode.label;

        return React.createElement(MentionEditor, {
            // Changing on a record boundary, so React remounts the editor and its
            // mention identities start empty for the new record.
            key: `mention-editor-${this.editorGeneration.toString()}`,
            value: this.value,
            disabled,
            maxLength: field.attributes?.MaxLength,
            label: hostLabel.trim().length > 0 ? hostLabel : FALLBACK_LABEL,
            listboxId: this.listboxId,
            userSearchProvider: this.userSearch,
            onChange: this.handleChange,
            onMentionSelected: this.handleMentionSelected,
            onWrittenMentionsChange: this.handleWrittenMentionsChange,
        });
    }

    /**
     * @returns The outputs defined as "bound" or "output" in the manifest.
     */
    public getOutputs(): IOutputs {
        return { field: this.value };
    }

    /**
     * Called when the control is removed from the DOM tree.
     */
    public destroy(): void {
        // Anything still inside its grace period is cancelled, not flushed. The
        // framework does not say whether the form was saved or discarded, and
        // flushing would turn a mention the user removed by navigating away into
        // a notification that cannot be taken back.
        //
        // A write already in flight cannot be recalled and finishes against the
        // record context its scope captured.
        this.closePersistence();
    }
}
