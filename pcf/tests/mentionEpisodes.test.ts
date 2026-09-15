import { MentionEpisodeTracker } from "../src/domain/mentionEpisodes";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";

/** Deterministic ids, so the tests can talk about which episode is which. */
function countingIds(): () => string {
    let next = 0;
    return () => {
        next += 1;
        return `event-${next.toString()}`;
    };
}

function tracker(): MentionEpisodeTracker {
    return new MentionEpisodeTracker(countingIds());
}

const alex: MentionOccurrence = {
    start: 0,
    name: "Alex Rivera",
    userId: "u-alex",
    email: "alex.rivera@example.invalid",
};
const dana: MentionOccurrence = { start: 20, name: "Dana Winter", userId: "u-dana" };

const ids = (events: readonly { eventId: string }[]): readonly string[] =>
    events.map((event) => event.eventId);

describe("MentionEpisodeTracker", () => {
    it("gives a person mentioned for the first time one notification", () => {
        // The identifier, the person, and where they stand. The name and the
        // address the suggestion carried stay in the editor.
        expect(tracker().update([alex])).toEqual([
            {
                eventId: "event-1",
                recipientUserId: "u-alex",
                occurrences: [{ start: 0, length: 12 }],
            },
        ]);
    });

    it("reports nothing about a person but who and where they are", () => {
        const events = tracker().update([alex, dana]);

        expect(events.map((event) => Object.keys(event).sort())).toEqual([
            ["eventId", "occurrences", "recipientUserId"],
            ["eventId", "occurrences", "recipientUserId"],
        ]);
    });

    it("gathers every place one person is mentioned under one notification", () => {
        const events = tracker().update([alex, { ...alex, start: 40 }]);

        expect(events).toEqual([
            {
                eventId: "event-1",
                recipientUserId: "u-alex",
                occurrences: [
                    { start: 0, length: 12 },
                    { start: 40, length: 12 },
                ],
            },
        ]);
    });

    it("keeps the identifier when an occurrence only moves", () => {
        const episodes = tracker();
        episodes.update([alex]);

        const moved = episodes.update([{ ...alex, start: 25 }]);

        expect(moved).toEqual([
            {
                eventId: "event-1",
                recipientUserId: "u-alex",
                occurrences: [{ start: 25, length: 12 }],
            },
        ]);
    });

    it("drops the occurrence that went and keeps the one that stayed", () => {
        const episodes = tracker();
        episodes.update([alex, { ...alex, start: 40 }]);

        const remaining = episodes.update([{ ...alex, start: 40 }]);

        expect(remaining[0]?.eventId).toBe("event-1");
        expect(remaining[0]?.occurrences).toEqual([{ start: 40, length: 12 }]);
    });

    it("takes up the episodes a saved record carried", () => {
        const episodes = tracker();

        episodes.adopt(new Map([["u-alex", "event-from-the-record"]]));

        expect(episodes.update([alex])).toEqual([
            {
                eventId: "event-from-the-record",
                recipientUserId: "u-alex",
                occurrences: [{ start: 0, length: 12 }],
            },
        ]);
    });

    it("replaces the episodes it was holding, rather than adding to them", () => {
        // The same record, saved again by somebody else, with a different person
        // at the same place. Two people share a display name often enough that
        // this is ordinary, not exotic.
        const episodes = tracker();
        episodes.adopt(new Map([["u-robin-a", "event-a"]]));
        episodes.update([{ start: 11, name: "Robin Fox", userId: "u-robin-a" }]);

        episodes.adopt(new Map([["u-robin-b", "event-b"]]));

        expect(episodes.events().map((event) => event.recipientUserId)).toEqual(["u-robin-b"]);
        expect(episodes.events().map((event) => event.eventId)).toEqual(["event-b"]);
    });

    it("does not let a replaced person carry their old identifier back", () => {
        const episodes = tracker();
        episodes.adopt(new Map([["u-robin-a", "event-a"]]));
        episodes.update([{ start: 11, name: "Robin Fox", userId: "u-robin-a" }]);

        episodes.adopt(new Map([["u-robin-b", "event-b"]]));
        // Whoever wrote the record last did not mean this person, so being
        // mentioned again is a new thing to tell them about, with a new
        // identifier — not a continuation of an episode nobody else knows about.
        const written = episodes.update([
            { start: 11, name: "Robin Fox", userId: "u-robin-b" },
            { start: 30, name: "Robin Fox", userId: "u-robin-a" },
        ]);

        expect(written).toEqual([
            {
                eventId: "event-b",
                recipientUserId: "u-robin-b",
                occurrences: [{ start: 11, length: 10 }],
            },
            {
                eventId: "event-1",
                recipientUserId: "u-robin-a",
                occurrences: [{ start: 30, length: 10 }],
            },
        ]);
    });

    it("empties itself when the record turns out to carry nobody", () => {
        const episodes = tracker();
        episodes.adopt(new Map([["u-alex", "event-from-the-record"]]));

        episodes.adopt(new Map());

        expect(episodes.events()).toEqual([]);
        // And the same person mentioned again is a new episode, not the old one.
        expect(ids(episodes.update([alex]))).toEqual(["event-1"]);
    });

    it("starts a new episode for somebody the record never carried", () => {
        const episodes = tracker();
        episodes.adopt(new Map([["u-alex", "event-from-the-record"]]));

        expect(episodes.update([dana])[0]?.eventId).toBe("event-1");
    });

    it("keeps the identifier while the mention only moves", () => {
        const episodes = tracker();
        const first = episodes.update([alex]);

        const moved = episodes.update([{ ...alex, start: 40 }]);

        expect(ids(moved)).toEqual(ids(first));
    });

    it("counts one person mentioned twice as one notification", () => {
        const events = tracker().update([alex, { ...alex, start: 50 }]);

        expect(events).toHaveLength(1);
        expect(events[0]?.eventId).toBe("event-1");
    });

    it("keeps the identifier while one of two occurrences survives", () => {
        const episodes = tracker();
        episodes.update([alex, { ...alex, start: 50 }]);

        const remaining = episodes.update([{ ...alex, start: 50 }]);

        expect(ids(remaining)).toEqual(["event-1"]);
    });

    it("ends the episode when the last occurrence goes", () => {
        const episodes = tracker();
        episodes.update([alex]);

        expect(episodes.update([])).toEqual([]);
    });

    it("starts a new episode when the person is mentioned again", () => {
        // A mention taken back and made again is a new thing to tell them about.
        const episodes = tracker();
        episodes.update([alex]);
        episodes.update([]);

        expect(ids(episodes.update([alex]))).toEqual(["event-2"]);
    });

    it("keeps two people who share a display name apart", () => {
        const events = tracker().update([
            { start: 0, name: "Robin Fox", userId: "id-a" },
            { start: 30, name: "Robin Fox", userId: "id-b" },
        ]);

        expect(events).toHaveLength(2);
        expect(events.map((event) => event.recipientUserId)).toEqual(["id-a", "id-b"]);
        expect(new Set(ids(events)).size).toBe(2);
    });

    it("treats braced and upper-case ids as one person", () => {
        const episodes = tracker();
        const first = episodes.update([
            { start: 0, name: "Alex Rivera", userId: "{AAAA-1111}" },
        ]);

        const again = episodes.update([{ start: 0, name: "Alex Rivera", userId: "aaaa-1111" }]);

        expect(ids(again)).toEqual(ids(first));
        expect(again[0]?.recipientUserId).toBe("aaaa-1111");
    });

    it("mentions nobody who cannot be identified", () => {
        expect(tracker().update([{ start: 0, name: "Alex Rivera", userId: "   " }])).toEqual([]);
    });

    it("gives the earlier identifier to the person named first in the text", () => {
        // Passed in the other order on purpose: text order decides, not the
        // order a caller happened to build the array in.
        const events = tracker().update([dana, alex]);

        expect(events.map((event) => [event.eventId, event.recipientUserId])).toEqual([
            ["event-1", "u-alex"],
            ["event-2", "u-dana"],
        ]);
    });

    it("says nothing about a person but who they are, however they are written", () => {
        const episodes = tracker();
        const before = episodes.update([alex]);

        const renamed = episodes.update([
            { ...alex, name: "A. Rivera", email: "somewhere.else@example.invalid" },
        ]);

        // Same notification, same person. Only the span follows the text: it
        // covers the name, so a shorter name is a shorter span.
        expect(renamed[0]?.eventId).toBe(before[0]?.eventId);
        expect(renamed[0]?.recipientUserId).toBe("u-alex");
        expect(renamed[0]?.occurrences).toEqual([{ start: 0, length: 10 }]);
        expect(Object.keys(renamed[0] ?? {}).sort()).toEqual([
            "eventId",
            "occurrences",
            "recipientUserId",
        ]);
    });

    it("reports what stands right now without being asked to update", () => {
        const episodes = tracker();
        episodes.update([alex, dana]);

        expect(ids(episodes.events())).toEqual(["event-1", "event-2"]);
    });

    it("hands out its own objects, never its storage", () => {
        const episodes = tracker();
        const events = episodes.update([alex]);

        (events[0] as { eventId: string }).eventId = "tampered";

        expect(episodes.events()[0]?.eventId).toBe("event-1");
    });

    it("forgets everything when it is reset", () => {
        const episodes = tracker();
        episodes.update([alex]);

        episodes.reset();

        // A new record, so the same person starts a new episode.
        expect(ids(episodes.update([alex]))).toEqual(["event-2"]);
        expect(episodes.events()).toHaveLength(1);
    });

    it("is empty after a reset until something is mentioned", () => {
        const episodes = tracker();
        episodes.update([alex]);

        episodes.reset();

        expect(episodes.events()).toEqual([]);
    });
});
