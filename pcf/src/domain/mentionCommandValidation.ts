import type {
    MentionCommandAction,
    MentionCommandEnvelopeV1,
    MentionCommandOccurrence,
} from "./mentionCommand";
import { MENTION_COMMAND_SCHEMA_VERSION } from "./mentionCommand";
import { isDataverseId } from "./recordContext";

/**
 * Says whether a command is one this control is willing to send at all.
 *
 * Two things this is, and one it is not.
 *
 * It **is** the client's last chance to notice that it is about to ask for
 * something incoherent — a half-built command, an identity that is not an
 * identity, a span that does not fit the text it claims to describe. Catching
 * that here turns a round trip and a server error into nothing at all.
 *
 * It **is** the written form of what a command must satisfy, so the rules exist
 * somewhere a person can read them rather than only inside a plug-in.
 *
 * It is **not** a security boundary, and nothing here should ever be mistaken
 * for one. Every value it inspects arrives from the same browser it runs in, so
 * a caller who wants to send something else simply does. The server validates
 * all of this again, against the record as it actually stands and against the
 * caller's actual rights, and its answer is the only one that decides anything.
 *
 * Pure: no React, no Dataverse, no component framework, no I/O.
 */

/**
 * Why a command was refused.
 *
 * Named rather than described, because these end up driving localized messages
 * and conditional retries, and a sentence cannot be switched on.
 */
export type MentionCommandRejection =
    | "unsupported-schema-version"
    | "malformed-command-id"
    | "malformed-record-table"
    | "malformed-record-id"
    | "malformed-source-field"
    | "invalid-field-revision"
    | "malformed-event-id"
    | "malformed-recipient-id"
    | "empty-occurrences"
    | "occurrence-out-of-range"
    | "unordered-occurrences"
    | "overlapping-occurrences"
    | "unchanged-recipient"
    | "reused-event-id";

/**
 * The verdict.
 *
 * Every reason is collected rather than only the first, because a command that
 * is wrong in two ways is worth knowing about in two ways: fixing one and
 * resubmitting to discover the other is a round trip nobody needed. The order is
 * the order the checks run in, which is fixed, so the same command always
 * produces the same list.
 */
export type MentionCommandValidation =
    | { readonly ok: true }
    | { readonly ok: false; readonly rejections: readonly MentionCommandRejection[] };

/** A logical name as Dataverse compares them: trimmed, lower case, not empty. */
function isNormalizedLogicalName(value: string): boolean {
    return value.length > 0 && value === value.trim().toLowerCase();
}

/** A revision is a count. Counts are whole and do not run backwards past zero. */
function isRevision(value: number): boolean {
    return Number.isInteger(value) && value >= 0;
}

/**
 * Checks the spans an action claims against the text that action wants to leave
 * behind.
 *
 * They are checked against `desiredSourceText` and not against the text as it
 * stands, because a command describes its own result. An "@Robin Fox" that will
 * sit at index 40 once the command has been applied is out of range of the text
 * before it — which is not a defect, it is the point.
 */
function collectOccurrenceRejections(
    occurrences: readonly MentionCommandOccurrence[],
    desiredSourceText: string
): MentionCommandRejection[] {
    if (occurrences.length === 0) {
        return ["empty-occurrences"];
    }

    const rejections: MentionCommandRejection[] = [];

    const inRange = occurrences.every(
        (occurrence) =>
            Number.isInteger(occurrence.start) &&
            Number.isInteger(occurrence.length) &&
            occurrence.start >= 0 &&
            occurrence.length >= 1 &&
            occurrence.start + occurrence.length <= desiredSourceText.length
    );
    if (!inRange) {
        rejections.push("occurrence-out-of-range");
    }

    // Order is part of the wire format: the serializer writes occurrences as
    // they are given, and two commands meaning the same thing have to produce the
    // same string. The builders sort; a command assembled some other way may not
    // have, and that is worth saying plainly rather than quietly reordering.
    let ordered = true;
    let previousStart = Number.NEGATIVE_INFINITY;
    for (const occurrence of occurrences) {
        if (occurrence.start < previousStart) {
            ordered = false;
            break;
        }
        previousStart = occurrence.start;
    }
    if (!ordered) {
        rejections.push("unordered-occurrences");
    }

    // Overlap is checked on a sorted copy, so an unordered set is still told
    // whether it also overlaps rather than only that it was unordered.
    const sorted = [...occurrences].sort((left, right) => left.start - right.start);
    let overlapping = false;
    let reach = Number.NEGATIVE_INFINITY;
    for (const occurrence of sorted) {
        if (occurrence.start < reach) {
            overlapping = true;
            break;
        }
        reach = occurrence.start + occurrence.length;
    }
    if (overlapping) {
        rejections.push("overlapping-occurrences");
    }

    return rejections;
}

/**
 * Checks the part of a command that says what is being done and to whom.
 *
 * The identity rules live here, and they are the reason the module exists:
 *
 * * an identity is a Dataverse user id or it is nothing — a display name is
 *   never one, an address is never one;
 * * a replacement whose two recipients are the same person is not a
 *   replacement, and letting one through would end an episode and open another
 *   for somebody who never stopped being mentioned;
 * * a replacement may not hand the previous episode's id to the new recipient.
 *   That id is already, or is about to be, a committed ledger entry naming
 *   somebody else. Reusing it would rewrite who that entry was about.
 */
function collectActionRejections(
    action: MentionCommandAction,
    desiredSourceText: string
): MentionCommandRejection[] {
    const rejections: MentionCommandRejection[] = [];

    switch (action.kind) {
        case "AddMention": {
            if (!isDataverseId(action.eventId)) {
                rejections.push("malformed-event-id");
            }
            if (!isDataverseId(action.recipientUserId)) {
                rejections.push("malformed-recipient-id");
            }
            rejections.push(...collectOccurrenceRejections(action.occurrences, desiredSourceText));
            return rejections;
        }
        case "RemoveMention": {
            if (!isDataverseId(action.eventId)) {
                rejections.push("malformed-event-id");
            }
            if (!isDataverseId(action.recipientUserId)) {
                rejections.push("malformed-recipient-id");
            }
            return rejections;
        }
        case "ReplaceRecipient": {
            if (!isDataverseId(action.previousEventId) || !isDataverseId(action.nextEventId)) {
                rejections.push("malformed-event-id");
            }
            if (
                !isDataverseId(action.previousRecipientUserId) ||
                !isDataverseId(action.nextRecipientUserId)
            ) {
                rejections.push("malformed-recipient-id");
            }
            if (action.previousRecipientUserId === action.nextRecipientUserId) {
                rejections.push("unchanged-recipient");
            }
            if (action.previousEventId === action.nextEventId) {
                rejections.push("reused-event-id");
            }
            rejections.push(...collectOccurrenceRejections(action.occurrences, desiredSourceText));
            return rejections;
        }
    }
}

/**
 * Says whether this command is coherent enough to be worth sending.
 *
 * The envelope is read and nothing is mutated; a command that passes is the same
 * object it was. Nothing is repaired either — a command that is wrong is
 * reported, not quietly corrected, because a correction would send something
 * nobody asked for.
 */
export function validateMentionCommand(command: MentionCommandEnvelopeV1): MentionCommandValidation {
    const rejections: MentionCommandRejection[] = [];

    if (command.schemaVersion !== MENTION_COMMAND_SCHEMA_VERSION) {
        rejections.push("unsupported-schema-version");
    }
    if (!isDataverseId(command.commandId)) {
        rejections.push("malformed-command-id");
    }
    if (!isNormalizedLogicalName(command.recordTable)) {
        rejections.push("malformed-record-table");
    }
    if (!isDataverseId(command.recordId)) {
        rejections.push("malformed-record-id");
    }
    if (!isNormalizedLogicalName(command.sourceField)) {
        rejections.push("malformed-source-field");
    }
    if (!isRevision(command.expectedFieldRevision)) {
        rejections.push("invalid-field-revision");
    }

    rejections.push(...collectActionRejections(command.action, command.desiredSourceText));

    return rejections.length === 0 ? { ok: true } : { ok: false, rejections };
}
