import type { MentionOccurrence } from "./mentionLifecycle";
import type { MentionNotificationEvent, MentionOccurrenceSpan } from "./mentionMetadata";
import { normalizeDataverseId } from "./recordContext";

/**
 * Keeps one notification per person for as long as that person stays mentioned.
 *
 * A mention moves constantly: text is typed in front of it, the same person may
 * be named twice, one of those names may be deleted. None of that is a new
 * notification. What counts is an *episode* — the stretch during which a person
 * is mentioned at all. An episode gets one identifier when it begins, keeps it
 * while at least one occurrence survives, and ends when the last one goes. Being
 * mentioned again afterwards is a new episode, with a new identifier, because it
 * is a new thing to tell them about.
 *
 * Identity is the normalized user id throughout. Two people who share a display
 * name are two episodes; the same person written with braces or in upper case is
 * one.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework. The
 * identifier source is injected so it can be made deterministic in tests.
 */

/** Produces an identifier that has never been used before. */
export type EventIdSource = () => string;

/** What is known about one person while the mentions standing in the text are read. */
interface OpenEpisode {
    readonly eventId: string;
    readonly occurrences: MentionOccurrenceSpan[];
}

export class MentionEpisodeTracker {
    private readonly newEventId: EventIdSource;
    /**
     * Every open episode by normalized recipient id, in the order the episodes
     * began.
     *
     * An episode is the identifier, the person, and where in the text they are
     * mentioned. What the mention says *about* them — the display name, the
     * address the suggestion carried — belongs to the editor and to the moment
     * of sending, not to the notification's identity.
     */
    private episodes = new Map<string, OpenEpisode>();

    constructor(newEventId: EventIdSource) {
        this.newEventId = newEventId;
    }

    /**
     * Takes the mentions standing in the text and reports who is to be notified.
     *
     * The set is authoritative: anybody missing from it has no occurrence left,
     * so their episode ends here. Mentions are read in text order, so which of
     * two people newly mentioned in one edit gets the earlier identifier does
     * not depend on the order a caller happened to pass them in.
     */
    public update(mentions: readonly MentionOccurrence[]): readonly MentionNotificationEvent[] {
        const next = new Map<string, OpenEpisode>();

        for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
            const recipientUserId = normalizeDataverseId(mention.userId);
            // Nobody can be identified from this, so nobody can be notified.
            if (recipientUserId.length === 0) {
                continue;
            }

            // An episode that is still running keeps the identifier it began
            // with, wherever the mention has moved to and however many times the
            // person is named. Only somebody who is not mentioned at all right
            // now can start a new one.
            const open = next.get(recipientUserId) ?? {
                eventId: this.episodes.get(recipientUserId)?.eventId ?? this.newEventId(),
                occurrences: [],
            };
            open.occurrences.push({ start: mention.start, length: mention.name.length + 1 });
            next.set(recipientUserId, open);
        }

        this.episodes = next;
        return this.events();
    }

    /**
     * Adopts the episodes a saved record carried, so reopening it continues the
     * notifications it already had rather than starting new ones.
     *
     * What is adopted **replaces** what was held, because a payload is the whole
     * saved episode state of the record it came with and not an addition to an
     * older one. The same record can legitimately be saved again with a
     * different person at the same place — two people share a display name far
     * too often for that to be theoretical — and merging would leave the person
     * who was replaced behind, still holding an identifier, ready to be
     * serialized back into the next edit as a recipient nobody named.
     *
     * Only what a caller has already validated reaches this: the tracker does
     * not read stored payloads and does not decide what is trustworthy.
     */
    public adopt(episodes: ReadonlyMap<string, string>): void {
        this.episodes = new Map<string, OpenEpisode>(
            [...episodes].map(([recipientUserId, eventId]) => [
                recipientUserId,
                { eventId, occurrences: [] },
            ])
        );
    }

    /** The notifications standing right now, as their own objects. */
    public events(): readonly MentionNotificationEvent[] {
        return [...this.episodes].map(([recipientUserId, episode]) => ({
            eventId: episode.eventId,
            recipientUserId,
            occurrences: episode.occurrences.map((occurrence) => ({
                start: occurrence.start,
                length: occurrence.length,
            })),
        }));
    }

    /**
     * Forgets everything.
     *
     * Used when the editor moves to another record: an episode belongs to the
     * record it was started on, and carrying one across would attach one
     * record's notification to another.
     */
    public reset(): void {
        this.episodes = new Map<string, OpenEpisode>();
    }
}
