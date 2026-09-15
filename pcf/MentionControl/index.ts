import * as React from "react";

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import type {
    MentionEditorState,
    MentionEditorStrings,
} from "../src/components/MentionEditor";
import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import { createEventId } from "../src/services/eventId";
import { MentionEpisodeTracker } from "../src/domain/mentionEpisodes";
import { hydratePersistedMentions } from "../src/domain/mentionHydration";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { serializeMentionMetadata } from "../src/domain/mentionMetadata";
import {
    isDataverseId,
    normalizeDataverseId,
    resolveRecordContext,
    sameRecordContext,
} from "../src/domain/recordContext";
import type { MentionRecordContext } from "../src/domain/recordContext";
import type { UserDirectory, UserSearchProvider } from "../src/domain/userSearch";

/** Accessible name used when the host supplies no column label. */
const FALLBACK_LABEL = "Ayonto Mention";

/**
 * One output of this control: the text and the mentions made in it, which are
 * two halves of a single editor state and are reconciled as one.
 */
/**
 * What one `updateView` turned out to be, from the control's point of view.
 *
 * The distinction matters because only one of the four says anything new about
 * *who* is mentioned. `unchanged` is the ordinary case by far — the framework
 * re-renders a control for all sorts of reasons, and the pair it reports is
 * usually the very pair already accepted. An acknowledgement is this control's
 * own state coming back; an echo is a value the user has already moved past.
 * None of those is a reason to read identities out of the payload again — doing
 * so on an acknowledgement would replace the session's live mentions with a
 * re-reading of its own output on every keystroke. Only a pair somebody else
 * decided is new, and that one has to be taken up whole.
 */
type ReconcileVerdict = "unchanged" | "acknowledged" | "echo" | "external";

interface OutputPair {
    readonly field: string;
    readonly metadata: string;
}

const EMPTY_PAIR: OutputPair = { field: "", metadata: "" };

/** Puts one value into a resource string that carries a `{0}` placeholder. */
function interpolate(template: string, value: string): string {
    return template.replace("{0}", value);
}

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
    private userSearch: UserSearchProvider & UserDirectory;
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
    /**
     * The localized strings the editor shows. Resource lookups do not change
     * over the life of a control instance, so they are read once.
     */
    private strings: MentionEditorStrings | undefined;
    /**
     * The mentions the record already carried, handed to the editor together
     * with the text they belong to. Re-read only when an authoritative pair
     * arrives: re-reading it on an ordinary `updateView` would talk over what
     * the user has done since.
     */
    private hydrated: readonly MentionOccurrence[] = [];
    /**
     * Names the authoritative pair the editor was last given. Bumped only where
     * a pair is taken up whole, which is the only thing that can change who a
     * mention means.
     *
     * The text alone cannot carry that news. The same record can be saved again
     * with the same words and a different person behind them — two people share
     * a display name often enough that "@Robin Fox" says nothing about which
     * Robin Fox — and an editor watching only the text string would keep the
     * identity it already had, show a token for the wrong person, and write that
     * person back on the next edit.
     */
    private hostRevision = 0;
    /** Opens the person a mention names. Replaced on every update view. */
    private navigation: ComponentFramework.Navigation;

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

        this.navigation = context.navigation;
        this.sourceField = (context.parameters.field.attributes?.LogicalName ?? "")
            .trim()
            .toLowerCase();

        const opened: OutputPair = {
            field: context.parameters.field.raw ?? "",
            metadata: context.parameters.mentionMetadata.raw ?? "",
        };
        this.acceptPair(opened);
        this.hydrate(opened);
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
    private reconcile(host: OutputPair): ReconcileVerdict {
        const pending = this.pending;
        if (pending === null) {
            // No cycle open: the host is authoritative. But the pair already
            // accepted is not news about anything, and treating every render as
            // a fresh decision would re-read the payload — and with it every
            // identity — over and over for nothing.
            if (host.field === this.accepted.field && host.metadata === this.accepted.metadata) {
                return "unchanged";
            }
            this.acceptPair(host);
            return "external";
        }

        if (host.field === pending.field && host.metadata === pending.metadata) {
            // 1: the whole output came back.
            this.acceptPair(pending);
            return "acknowledged";
        }

        if (host.field === pending.field) {
            // 2: one half of it came back.
            return "echo";
        }

        if (host.field === this.accepted.field) {
            // 3: the text this cycle started from.
            return "echo";
        }

        if (this.emittedFieldsInCycle.has(host.field)) {
            // 4: a text from earlier in this cycle.
            return "echo";
        }

        // 5: a genuinely external text closes the cycle.
        this.acceptPair(host);
        return "external";
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
            this.hydrated = [];
            this.editorGeneration += 1;
        }

        return crossedBoundary;
    }

    /**
     * Takes up the mentions a saved record already carried.
     *
     * The payload is read exactly once per record, against the text and the
     * column it was written for, and only what survives that check becomes a
     * mention. The identifiers come with it, so reopening a record continues the
     * notifications it already had instead of starting new ones — and nothing is
     * written back: taking a record up is not editing it.
     */
    private hydrate(pair: OutputPair): void {
        const { mentions, episodes } = hydratePersistedMentions(
            pair.metadata,
            this.sourceField,
            pair.field
        );
        this.hydrated = mentions;
        this.episodes.adopt(episodes);
        // Text and identities are one state, and this is the moment it changes.
        this.hostRevision += 1;
    }

    /**
     * Opens the Dataverse user a mention names, through the framework's own
     * navigation. A failure is consumed: it can carry the environment URL with
     * it, the text is still perfectly readable, and there is nothing the person
     * reading it could do about it anyway.
     */
    private readonly handleOpenUser = (userId: string): void => {
        const entityId = normalizeDataverseId(userId);
        // Last check before the platform is asked to go somewhere. Nothing that
        // is not a record id is worth a navigation, and the editor is not the
        // only thing that could ever hand one over.
        if (!isDataverseId(entityId)) {
            return;
        }

        void this.navigation.openForm({ entityName: "systemuser", entityId })
            .catch(() => undefined);
    };

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
            // Another record, another set of mentions to take up.
            this.hydrate(host);
        } else if (this.reconcile(host) === "external") {
            // Somebody else decided this record's pair, and the payload beside
            // the text describes *that* text. Reading it here, in the same step
            // that accepted it, is what keeps the two halves one state: the
            // editor is never handed one save's words with another save's people
            // attached to them. That holds when only the payload changed, too —
            // the same sentence can be saved again meaning a different person.
            // An acknowledgement, a late echo and a pair already accepted change
            // nothing, so none of them disturbs what the session is holding.
            this.hydrate(this.current);
        }
        this.navigation = context.navigation;

        // A column the user may not write to is read-only even when the form as a
        // whole is editable.
        const disabled = context.mode.isControlDisabled || field.security?.editable === false;
        // A column the user may not read shows nothing at all. The value stays in
        // this control's own state and is still reported back unchanged by
        // `getOutputs`; it simply never reaches the editor, and therefore never
        // reaches the DOM.
        const masked = field.security?.readable === false;
        // A mention has to be recorded somewhere to mean anything later. Where
        // the host will not accept the companion value, the safe answer is to
        // offer nobody rather than to create an identity that is silently lost.
        this.mentionsAllowed = metadata.security?.editable !== false;
        // Without a connection the user lookup cannot run, so the picker stays
        // shut and says why. Typing is untouched: an offline field is still a
        // field. The platform is asked, never the browser — `navigator.onLine`
        // reports a network interface, not whether Dataverse can be reached.
        const offline = this.isOffline(context);
        const notice = offline ? this.getStrings(context).offlineNotice : undefined;
        const hostLabel = context.mode.label;

        return React.createElement(MentionEditor, {
            // Changing on a record boundary, so React remounts the editor and its
            // mention identities start empty for the new record.
            key: `mention-editor-${this.editorGeneration.toString()}`,
            // The value is handed over as it is, masked or not. Masking is how the
            // field is *shown*, not a change to what it holds: telling the editor
            // the host value had become empty would make it adopt that emptiness,
            // reanchor every tracked mention away and report a set of mentions
            // nobody edited — turning a security setting into a data change.
            value: this.current.field,
            disabled: disabled || masked,
            masked,
            notice,
            canMention: this.mentionsAllowed && !masked && notice === undefined,
            maxLength: field.attributes?.MaxLength,
            label: hostLabel.trim().length > 0 ? hostLabel : FALLBACK_LABEL,
            listboxId: this.listboxId,
            strings: this.getStrings(context),
            userSearchProvider: this.userSearch,
            userDirectory: this.userSearch,
            // Asked of the platform, not read back out of a message shown to the
            // user: a localized sentence is for reading, not for deciding with.
            // Offline, a recorded mention simply reads as text — the record is
            // not touched, and the question is put again once there is somewhere
            // to put it.
            canVerifyPersistedMentions: !offline,
            initialMentions: this.hydrated,
            hostRevision: this.hostRevision,
            onLocalEdit: this.handleLocalEdit,
            onHostValueAdopted: this.handleHostValueAdopted,
            onOpenUser: this.handleOpenUser,
        });
    }

    /**
     * True when Dataverse cannot be reached.
     *
     * Both methods are documented for model-driven apps only, and a host that
     * does not implement them simply does not answer — which is treated as
     * "not known to be offline" rather than as an error.
     */
    private isOffline(context: ComponentFramework.Context<IInputs>): boolean {
        const client: Partial<ComponentFramework.Client> = context.client;
        return client.isOffline?.() === true || client.isNetworkAvailable?.() === false;
    }

    /** The localized strings for the editor, read from the control's resources. */
    private getStrings(context: ComponentFramework.Context<IInputs>): MentionEditorStrings {
        const resources = context.resources;
        const formatting = context.formatting;
        const strings: MentionEditorStrings = (this.strings ??= {
            placeholder: resources.getString("Editor_Placeholder"),
            noResults: resources.getString("Editor_NoResults"),
            searching: resources.getString("Editor_Searching"),
            lookupFailed: resources.getString("Editor_LookupFailed"),
            mentionTooLong: resources.getString("Editor_MentionTooLong"),
            moreResults: resources.getString("Editor_MoreResults"),
            maskedValue: resources.getString("Editor_MaskedValue"),
            offlineNotice: resources.getString("Editor_OfflineNotice"),
            openMentionedUser: (name: string) =>
                interpolate(resources.getString("Editor_OpenMentionedUser"), name),
            suggestionsAvailable: (count: number) =>
                interpolate(
                    resources.getString(
                        count === 1 ? "Editor_SuggestionCountOne" : "Editor_SuggestionCount"
                    ),
                    formatting.formatInteger(count)
                ),
            charactersLeft: (remaining: number) =>
                interpolate(
                    resources.getString("Editor_CharactersLeft"),
                    formatting.formatInteger(remaining)
                ),
        });
        return strings;
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
