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

interface Episode {
    readonly eventId: string;
    readonly recipientUserId: string;
    recipientName: string;
    recipientEmail: string | undefined;
}

export class MentionEpisodeTracker {
    private readonly newEventId: EventIdSource;
    /** Open episodes by normalized recipient id, in the order they began. */
    private episodes = new Map<string, Episode>();

    constructor(newEventId: EventIdSource) {
        this.newEventId = newEventId;
    }

    /**
     * Takes the mentions standing in the text and reports who is to be notified.
     *
     * The set is authoritative: anybody missing from it has no occurrence left,
     * so their episode ends here. What each event says about a person — their
     * name, their address — is read from their **first** occurrence in text
     * order, which is the one a reader would call the mention.
     */
    public update(mentions: readonly MentionOccurrence[]): readonly MentionNotificationEvent[] {
        const next = new Map<string, Episode>();

        for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
            const recipientUserId = normalizeDataverseId(mention.userId);
            // Nobody can be identified from this, so nobody can be notified.
            if (recipientUserId.length === 0 || next.has(recipientUserId)) {
                continue;
            }

            const email = (mention.email ?? "").trim();
            const open = this.episodes.get(recipientUserId);
            next.set(recipientUserId, {
                // An episode that is still running keeps the identifier it began
                // with. Only a person who is not mentioned at all right now can
                // start a new one.
                eventId: open?.eventId ?? this.newEventId(),
                recipientUserId,
                recipientName: mention.name.trim(),
                recipientEmail: email.length > 0 ? email : undefined,
            });
        }

        this.episodes = next;
        return this.events();
    }

    /** The notifications standing right now, as their own objects. */
    public events(): readonly MentionNotificationEvent[] {
        return [...this.episodes.values()].map((episode) =>
            episode.recipientEmail === undefined
                ? {
                      eventId: episode.eventId,
                      recipientUserId: episode.recipientUserId,
                      recipientName: episode.recipientName,
                  }
                : {
                      eventId: episode.eventId,
                      recipientUserId: episode.recipientUserId,
                      recipientName: episode.recipientName,
                      recipientEmail: episode.recipientEmail,
                  }
        );
    }

    /**
     * Forgets everything.
     *
     * Used when the editor moves to another record: an episode belongs to the
     * record it was started on, and carrying one across would attach one
     * record's notification to another.
     */
    public reset(): void {
        this.episodes = new Map<string, Episode>();
    }
}
