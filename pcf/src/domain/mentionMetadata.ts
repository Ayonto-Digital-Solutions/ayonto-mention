/**
 * The companion payload: who the current editing session means to notify,
 * written out with the record so that it is committed by the same save as the
 * text, or not at all.
 *
 * It carries identity and nothing else. Not where a mention sits — positions
 * move with every keystroke and no later reader needs them. Not the text — that
 * is already in the row it travels with, and a second copy would be a second
 * truth. Not a hash of the text — a snapshot has to prove a save happened only
 * when nothing else can, and here the save proves itself.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 */

/** The wire format this control writes. Bumped when the shape changes. */
export const MENTION_METADATA_SCHEMA_VERSION = 1;

/** One person the current session means to notify, once. */
export interface MentionNotificationEvent {
    /**
     * Identifies this notification for good. Generated where the mention is
     * made, so a payload processed twice cannot notify twice.
     */
    readonly eventId: string;
    /** The identity. Normalized, and never the display name. */
    readonly recipientUserId: string;
    readonly recipientName: string;
    /** Left out entirely when the suggestion carried none. */
    readonly recipientEmail?: string | undefined;
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
 * key order is then fixed by this function, and an absent address is absent
 * rather than present and empty.
 */
export function serializeMentionMetadata(
    sourceField: string,
    events: readonly MentionNotificationEvent[]
): string {
    const mentions = [...events]
        .sort((left, right) => left.recipientUserId.localeCompare(right.recipientUserId))
        .map((event) => {
            const email = (event.recipientEmail ?? "").trim();
            return email.length === 0
                ? {
                      eventId: event.eventId,
                      recipientUserId: event.recipientUserId,
                      recipientName: event.recipientName,
                  }
                : {
                      eventId: event.eventId,
                      recipientUserId: event.recipientUserId,
                      recipientName: event.recipientName,
                      recipientEmail: email,
                  };
        });

    const envelope: MentionMetadataEnvelope = {
        schemaVersion: MENTION_METADATA_SCHEMA_VERSION,
        sourceField,
        mentions,
    };

    return JSON.stringify(envelope);
}
