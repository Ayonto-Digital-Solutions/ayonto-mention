import type { MentionRecordContext } from "./recordContext";
import { normalizeDataverseId } from "./recordContext";

/**
 * The command a tracked mention is committed through.
 *
 * A tracked mention is not ordinary typing. Typing changes text, and text is
 * saved when the form is saved; nothing about it needs a server to agree. Adding
 * a person, removing one, or putting a different person in the same place is a
 * different thing: it decides who gets told, and that decision cannot be left to
 * a client. So it travels as a *command* — a statement of what the editor wants
 * to be true, which a server validates against the record as it actually stands
 * and then either commits whole or refuses whole.
 *
 * What the command is therefore built to carry is the intent plus everything a
 * server needs to refuse it:
 *
 * * the exact identity of who is affected, never their name,
 * * the text as the editor believed it to be, so a concurrent edit is caught,
 * * the state revision the editor read, so a concurrent command is caught,
 * * the text the editor wants to leave behind.
 *
 * What it deliberately does not carry: display names, e-mail addresses, record
 * URLs, environment or tenant identifiers. None of those identify anybody, and
 * every one of them would be a copy of something that belongs somewhere else. A
 * server that needs a name reads it from `systemuser`, which is the only place
 * it can be trusted.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 * Nothing here talks to anything; it describes what would be said.
 */

/** The wire format this control writes. Bumped when the shape changes. */
export const MENTION_COMMAND_SCHEMA_VERSION = 1;

/**
 * Where one mention stands in the text the command wants to leave behind.
 *
 * `start` is a zero-based UTF-16 index — the same index JavaScript strings use —
 * and points at the "@". `length` covers the whole visible "@Display Name" and
 * stops there.
 *
 * These are positions in `desiredSourceText`, not in the text as it stands now,
 * because the command is a statement about the result. They describe where the
 * editor drew something; they identify nobody. Whoever can write the text can
 * write any position they like, so a position can never be a reason to notify
 * anyone.
 */
export interface MentionCommandOccurrence {
    readonly start: number;
    readonly length: number;
}

/**
 * Somebody is mentioned in this column who was not mentioned in it before.
 *
 * `eventId` names the episode that begins here. It is generated where the
 * mention is made, so the same command processed twice cannot begin two
 * episodes.
 */
export interface AddMentionAction {
    readonly kind: "AddMention";
    readonly eventId: string;
    readonly recipientUserId: string;
    readonly occurrences: readonly MentionCommandOccurrence[];
}

/**
 * The last occurrence of somebody is gone from this column.
 *
 * No occurrences travel with it: the point of the command is that there are
 * none left. The episode named by `eventId` ends, and the ledger entry it
 * produced stays exactly as it was — an episode that happened does not stop
 * having happened because the text moved on.
 */
export interface RemoveMentionAction {
    readonly kind: "RemoveMention";
    readonly eventId: string;
    readonly recipientUserId: string;
}

/**
 * One person is taken out of this column and another put in.
 *
 * This is the case the whole architecture exists for. Two people are called
 * Robin Fox, the editor swaps one for the other, and the visible text does not
 * change by a single byte. No amount of comparing text, counting spans or
 * matching display names can see that anything happened — which is exactly why
 * none of those may be allowed to decide it. The replacement is an explicit act
 * by a person choosing a different entry from the directory, and it is carried
 * here as two plainly different user ids.
 *
 * The two event ids are just as deliberately separate. The previous episode
 * ends; it does not become somebody else's. Reusing its id for the new
 * recipient would quietly rewrite who an already committed ledger entry was
 * about, which is the one thing an immutable ledger may never do. So the new
 * recipient begins a new episode with a new id, and `validateMentionCommand`
 * refuses a command that says otherwise.
 */
export interface ReplaceRecipientAction {
    readonly kind: "ReplaceRecipient";
    readonly previousEventId: string;
    readonly previousRecipientUserId: string;
    readonly nextEventId: string;
    readonly nextRecipientUserId: string;
    readonly occurrences: readonly MentionCommandOccurrence[];
}

/**
 * The tracked actions that exist.
 *
 * Exactly three, and the union is closed on purpose: a command whose kind is
 * not one of these is not a command this control knows how to mean.
 */
export type MentionCommandAction = AddMentionAction | RemoveMentionAction | ReplaceRecipientAction;

/** What every command says about the record it applies to, whatever the action. */
export interface MentionCommandEnvelopeV1 {
    readonly schemaVersion: number;
    /**
     * Identifies this command, and only this command.
     *
     * Not the same thing as an event id, and the distinction matters: a command
     * is an attempt, an event is a committed fact. One command produces at most
     * one new episode, an attempt that fails produces none, and a command
     * submitted twice after a lost response must be recognisable as the same
     * attempt rather than processed as a second one.
     */
    readonly commandId: string;
    /** Logical name of the table the source record lives in. */
    readonly recordTable: string;
    /** The source record. */
    readonly recordId: string;
    /** Logical name of the text column the mention was written in. */
    readonly sourceField: string;
    /**
     * The authoritative state revision the editor had read when it built this.
     *
     * A server that finds a different one knows another command landed in
     * between and refuses this one rather than overwriting what that command
     * decided.
     */
    readonly expectedFieldRevision: number;
    /**
     * The column's text as the editor believed it to stand right now.
     *
     * Checked against the record as it actually is, so an edit made elsewhere in
     * the meantime stops the command instead of being silently discarded.
     */
    readonly expectedSourceText: string;
    /** The text the command wants the column to hold once it has been applied. */
    readonly desiredSourceText: string;
    readonly action: MentionCommandAction;
}

/**
 * Everything a command says about its record, before anybody says what to do.
 *
 * Grouped because all three builders need the same six values and none of them
 * varies with the action. Passing them as one argument also makes it hard to
 * build a command for one record while describing an action on another.
 */
export interface MentionCommandScope {
    readonly commandId: string;
    /** Already normalized by `resolveRecordContext`, which is where it comes from. */
    readonly context: MentionRecordContext;
    readonly expectedFieldRevision: number;
    readonly expectedSourceText: string;
    readonly desiredSourceText: string;
}

/** The identity and placement of one person, as a caller supplies them. */
export interface AddMentionInput {
    readonly eventId: string;
    readonly recipientUserId: string;
    readonly occurrences: readonly MentionCommandOccurrence[];
}

/** The identity of the person whose last occurrence has gone. */
export interface RemoveMentionInput {
    readonly eventId: string;
    readonly recipientUserId: string;
}

/** Both identities involved in a replacement, each with its own episode. */
export interface ReplaceRecipientInput {
    readonly previousEventId: string;
    readonly previousRecipientUserId: string;
    readonly nextEventId: string;
    readonly nextRecipientUserId: string;
    readonly occurrences: readonly MentionCommandOccurrence[];
}

/**
 * Puts occurrences in text order and copies them into objects of this module's
 * own making.
 *
 * Ordering is not cosmetic: two commands that mean the same thing serialize to
 * the same string, so a retry is recognisable as a retry. Copying keeps whatever
 * a caller happened to carry alongside an occurrence from travelling with it.
 */
function orderOccurrences(
    occurrences: readonly MentionCommandOccurrence[]
): readonly MentionCommandOccurrence[] {
    return [...occurrences]
        .sort((left, right) => left.start - right.start)
        .map((occurrence) => ({ start: occurrence.start, length: occurrence.length }));
}

/**
 * Builds the envelope part of a command.
 *
 * The record context arrives already normalized — `resolveRecordContext` is what
 * produces one — so only the ids a caller supplies are normalized here. That is
 * deliberate: normalization lives in one place, and this module reuses it rather
 * than keeping a second opinion about what a Dataverse id looks like.
 */
function envelope(scope: MentionCommandScope, action: MentionCommandAction): MentionCommandEnvelopeV1 {
    return {
        schemaVersion: MENTION_COMMAND_SCHEMA_VERSION,
        commandId: normalizeDataverseId(scope.commandId),
        recordTable: scope.context.recordTable,
        recordId: scope.context.recordId,
        sourceField: scope.context.sourceField,
        expectedFieldRevision: scope.expectedFieldRevision,
        expectedSourceText: scope.expectedSourceText,
        desiredSourceText: scope.desiredSourceText,
        action,
    };
}

/** States that somebody is now mentioned who was not mentioned before. */
export function buildAddMentionCommand(
    scope: MentionCommandScope,
    input: AddMentionInput
): MentionCommandEnvelopeV1 {
    return envelope(scope, {
        kind: "AddMention",
        eventId: normalizeDataverseId(input.eventId),
        recipientUserId: normalizeDataverseId(input.recipientUserId),
        occurrences: orderOccurrences(input.occurrences),
    });
}

/** States that somebody's last occurrence has gone from the column. */
export function buildRemoveMentionCommand(
    scope: MentionCommandScope,
    input: RemoveMentionInput
): MentionCommandEnvelopeV1 {
    return envelope(scope, {
        kind: "RemoveMention",
        eventId: normalizeDataverseId(input.eventId),
        recipientUserId: normalizeDataverseId(input.recipientUserId),
    });
}

/**
 * States that one person has been taken out and another put in.
 *
 * Both identities are supplied by the caller and neither is derived from
 * anything. This builder will happily assemble a replacement whose two
 * recipients are the same person or whose two episodes share an id; it is
 * `validateMentionCommand` that refuses those, so that the same rule applies to
 * a command whatever route it arrived by.
 */
export function buildReplaceRecipientCommand(
    scope: MentionCommandScope,
    input: ReplaceRecipientInput
): MentionCommandEnvelopeV1 {
    return envelope(scope, {
        kind: "ReplaceRecipient",
        previousEventId: normalizeDataverseId(input.previousEventId),
        previousRecipientUserId: normalizeDataverseId(input.previousRecipientUserId),
        nextEventId: normalizeDataverseId(input.nextEventId),
        nextRecipientUserId: normalizeDataverseId(input.nextRecipientUserId),
        occurrences: orderOccurrences(input.occurrences),
    });
}

/** Writes the action exactly as it goes on the wire, and nothing else. */
function serializeAction(action: MentionCommandAction): Record<string, unknown> {
    const occurrences = (
        supplied: readonly MentionCommandOccurrence[]
    ): { start: number; length: number }[] =>
        supplied.map((occurrence) => ({ start: occurrence.start, length: occurrence.length }));

    switch (action.kind) {
        case "AddMention":
            return {
                kind: action.kind,
                eventId: action.eventId,
                recipientUserId: action.recipientUserId,
                occurrences: occurrences(action.occurrences),
            };
        case "RemoveMention":
            return {
                kind: action.kind,
                eventId: action.eventId,
                recipientUserId: action.recipientUserId,
            };
        case "ReplaceRecipient":
            return {
                kind: action.kind,
                previousEventId: action.previousEventId,
                previousRecipientUserId: action.previousRecipientUserId,
                nextEventId: action.nextEventId,
                nextRecipientUserId: action.nextRecipientUserId,
                occurrences: occurrences(action.occurrences),
            };
    }
}

/**
 * Writes the command exactly as it goes into the payload column.
 *
 * `JSON.stringify` is given an explicit shape rather than the envelope itself,
 * for the same reason the metadata serializer is: key order is then fixed here,
 * and anything a caller happens to carry alongside a command — a display name, an
 * address, a record URL, an environment id — cannot reach the payload by
 * accident. The shape below is the whole contract; a field that is not written
 * here does not exist on the wire.
 *
 * Deterministic on purpose: the same command produces the same string, so a
 * resubmitted attempt is recognisable as the same attempt.
 */
export function serializeMentionCommand(command: MentionCommandEnvelopeV1): string {
    return JSON.stringify({
        schemaVersion: command.schemaVersion,
        commandId: command.commandId,
        recordTable: command.recordTable,
        recordId: command.recordId,
        sourceField: command.sourceField,
        expectedFieldRevision: command.expectedFieldRevision,
        expectedSourceText: command.expectedSourceText,
        desiredSourceText: command.desiredSourceText,
        action: serializeAction(command.action),
    });
}
