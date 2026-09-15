/**
 * The companion payload: who the current editing session means to notify,
 * written out with the record so that it is committed by the same save as the
 * text, or not at all.
 *
 * It carries identity, and where in the text that identity was written. Not the
 * person's name or address: those are resolved from `systemuser` where the
 * notification is actually sent, which is the only place they can be trusted —
 * this payload is written into a column on a business record, and anyone who may
 * write the text may write this too. A name or an address taken from here would
 * be whatever the writer chose. They would also be a copy of somebody's personal
 * data, sitting in a hidden column on an unrelated record, for as long as that
 * record exists. Nor the text — that is already in the row this travels with,
 * and a second copy would be a second truth. Nor a hash of the text — a snapshot
 * has to prove a save happened only when nothing else can, and here the save
 * proves itself.
 *
 * The occurrence positions **are** written, and they exist for one job: reading a
 * saved record back. Reopening a record has to be able to find the mentions that
 * were in it, and the text alone cannot say which "@Robin Fox" meant which Robin
 * Fox. They are editor state travelling with the record, nothing more.
 *
 * What a position is not: it is not identity, it is not permission, and it is not
 * part of what makes a notification the notification it is — that is the event
 * identifier and the recipient. A server-side step may read a position to
 * understand what the editor drew. It must never treat one as a reason to notify
 * anybody, because whoever can write the text can write any position they like.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 */

/** The wire format this control writes. Bumped when the shape changes. */
export const MENTION_METADATA_SCHEMA_VERSION = 1;

/**
 * Where one mention stands in the text.
 *
 * `start` is a zero-based UTF-16 index — the same index JavaScript strings use —
 * and points at the "@". `length` covers the whole visible "@Display Name" and
 * stops there: the space a mention is usually followed by belongs to the
 * sentence, not to the mention.
 *
 * This is editor state, and nothing more. A later server step may read it to
 * understand what the editor drew, and must never treat a position as a reason
 * to notify anybody: what identifies a notification is the event, the record,
 * the column and the recipient. A position cannot authorize anything, because
 * whoever can write the text can write any position they like.
 */
export interface MentionOccurrenceSpan {
    readonly start: number;
    readonly length: number;
}

/** One person the current session means to notify, once. */
export interface MentionNotificationEvent {
    /**
     * Identifies this notification for good. Generated where the mention is
     * made, so a payload processed twice cannot notify twice. It names nothing
     * and grants nothing: whoever reads it still has to decide what it may do.
     */
    readonly eventId: string;
    /** The identity. Normalized, and never the display name. */
    readonly recipientUserId: string;
    /**
     * Every place this person is mentioned in the text right now, in text order.
     * One episode, however many occurrences: they are where the mention is, not
     * how often it is worth telling them.
     */
    readonly occurrences: readonly MentionOccurrenceSpan[];
}

export interface MentionMetadataEnvelope {
    readonly schemaVersion: number;
    /** Logical name of the text column these mentions were written in. */
    readonly sourceField: string;
    readonly mentions: readonly MentionNotificationEvent[];
}

/**
 * Writes the payload exactly as it goes into the column.
 *
 * Deterministic on purpose: the same set of events produces the same string, so
 * a value that did not change cannot look like a change. Events are ordered by
 * recipient rather than by where the mention stands, because text positions move
 * for reasons that have nothing to do with who is being notified.
 *
 * `JSON.stringify` is given an explicit shape rather than the events themselves:
 * key order is then fixed by this function, and anything a caller happens to
 * carry alongside an event cannot leak into the column by accident.
 */
export function serializeMentionMetadata(
    sourceField: string,
    events: readonly MentionNotificationEvent[]
): string {
    const mentions = [...events]
        .sort((left, right) => left.recipientUserId.localeCompare(right.recipientUserId))
        .map((event) => ({
            eventId: event.eventId,
            recipientUserId: event.recipientUserId,
            occurrences: [...event.occurrences]
                .sort((left, right) => left.start - right.start)
                .map((occurrence) => ({
                    start: occurrence.start,
                    length: occurrence.length,
                })),
        }));

    const envelope: MentionMetadataEnvelope = {
        schemaVersion: MENTION_METADATA_SCHEMA_VERSION,
        sourceField,
        mentions,
    };

    return JSON.stringify(envelope);
}
