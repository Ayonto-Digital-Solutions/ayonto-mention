import type { MentionOccurrence } from "./mentionLifecycle";
import type { MentionNotificationEvent } from "./mentionMetadata";
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

export class MentionEpisodeTracker {
    private readonly newEventId: EventIdSource;
    /**
     * The identifier of every open episode, by normalized recipient id, in the
     * order the episodes began.
     *
     * An episode is the identifier and the person, and nothing else. What the
     * mention says about them — the display name, the address the suggestion
     * carried — belongs to the editor and to the moment of sending, not to the
     * notification's identity.
     */
    private episodes = new Map<string, string>();

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
        const next = new Map<string, string>();

        for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
            const recipientUserId = normalizeDataverseId(mention.userId);
            // Nobody can be identified from this, so nobody can be notified.
            if (recipientUserId.length === 0 || next.has(recipientUserId)) {
                continue;
            }

            // An episode that is still running keeps the identifier it began
            // with. Only a person who is not mentioned at all right now can
            // start a new one.
            next.set(
                recipientUserId,
                this.episodes.get(recipientUserId) ?? this.newEventId()
            );
        }

        this.episodes = next;
        return this.events();
    }

    /** The notifications standing right now, as their own objects. */
    public events(): readonly MentionNotificationEvent[] {
        return [...this.episodes].map(([recipientUserId, eventId]) => ({
            eventId,
            recipientUserId,
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
        this.episodes = new Map<string, string>();
    }
}
