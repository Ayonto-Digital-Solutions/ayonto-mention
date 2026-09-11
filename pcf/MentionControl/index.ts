import * as React from "react";

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import { resolveRecordContext } from "../src/domain/recordContext";
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
     * Called whenever a value in the property bag changes.
     * @param context Property bag provided by the framework.
     * @returns The root React element for the control.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const field = context.parameters.field;
        const hostValue = field.raw ?? "";
        this.reconcile(hostValue);

        // The column name comes from the bound field's own metadata, which the
        // framework documents and types, so the maker does not have to configure
        // it and no host internals are touched to discover it.
        this.recordContext = resolveRecordContext({
            recordId: context.parameters.recordId.raw,
            recordTable: context.parameters.recordTable.raw,
            sourceField: field.attributes?.LogicalName,
        });

        // A column the user may not write to is read-only even when the form as a
        // whole is editable.
        const disabled = context.mode.isControlDisabled || field.security?.editable === false;
        const hostLabel = context.mode.label;

        return React.createElement(MentionEditor, {
            value: this.value,
            disabled,
            maxLength: field.attributes?.MaxLength,
            label: hostLabel.trim().length > 0 ? hostLabel : FALLBACK_LABEL,
            listboxId: this.listboxId,
            userSearchProvider: this.userSearch,
            onChange: this.handleChange,
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
        // The React tree is owned by the framework, and the lookup holds no
        // listeners or timers of its own.
    }
}
