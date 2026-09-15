import { hydratePersistedMentions } from "../src/domain/mentionHydration";

/** Fictional identifiers, in the canonical shape this control writes. */
const EVENT_A = "11111111-2222-4333-8444-555555555555";
const EVENT_B = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const USER_A = "aaaaaaaa-1111-2222-3333-444444444444";
const USER_B = "bbbbbbbb-5555-6666-7777-888888888888";

const FIELD = "description";
/** "Hello @Alex Rivera today" — the mention runs from 6, twelve characters long. */
const TEXT = "Hello @Alex Rivera today";

interface Span {
    readonly start: number;
    readonly length: number;
}

function payload(
    mentions: readonly { eventId: string; recipientUserId: string; occurrences: readonly Span[] }[],
    over: Record<string, unknown> = {}
): string {
    return JSON.stringify({
        schemaVersion: 1,
        sourceField: FIELD,
        mentions,
        ...over,
    });
}

const alexOnce = payload([
    { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
]);

const hydrate = (raw: string, text: string = TEXT, field: string = FIELD) =>
    hydratePersistedMentions(raw, field, text);

describe("hydratePersistedMentions", () => {
    it("takes up a mention the record carried", () => {
        expect(hydrate(alexOnce).mentions).toEqual([
            { start: 6, name: "Alex Rivera", userId: USER_A },
        ]);
    });

    it("reads the name out of the saved text, not out of the payload", () => {
        // Nothing in the payload says "Alex Rivera"; the text does.
        expect(alexOnce).not.toContain("Alex");
        expect(hydrate(alexOnce).mentions[0]?.name).toBe("Alex Rivera");
    });

    it("takes up the identifier, so reopening continues the same notification", () => {
        expect([...hydrate(alexOnce).episodes]).toEqual([[USER_A, EVENT_A]]);
    });

    it("takes up every place one person is mentioned", () => {
        const text = "@Alex Rivera and @Alex Rivera ";
        const raw = payload([
            {
                eventId: EVENT_A,
                recipientUserId: USER_A,
                occurrences: [
                    { start: 0, length: 12 },
                    { start: 17, length: 12 },
                ],
            },
        ]);

        expect(hydrate(raw, text).mentions.map((mention) => mention.start)).toEqual([0, 17]);
        expect([...hydrate(raw, text).episodes]).toEqual([[USER_A, EVENT_A]]);
    });

    it("keeps two people who share a display name apart", () => {
        const text = "@Robin Fox and @Robin Fox ";
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 10 }] },
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 15, length: 10 }] },
        ]);

        expect(hydrate(raw, text).mentions).toEqual([
            { start: 0, name: "Robin Fox", userId: USER_A },
            { start: 15, name: "Robin Fox", userId: USER_B },
        ]);
    });

    it("normalizes a braced or upper-case recipient id", () => {
        const raw = payload([
            {
                eventId: EVENT_A.toUpperCase(),
                recipientUserId: `{${USER_A.toUpperCase()}}`,
                occurrences: [{ start: 6, length: 12 }],
            },
        ]);

        expect(hydrate(raw).mentions[0]?.userId).toBe(USER_A);
        expect([...hydrate(raw).episodes]).toEqual([[USER_A, EVENT_A]]);
    });

    it("returns to ordinary text for anything it cannot read", () => {
        for (const raw of [
            "",
            "   ",
            "not json at all",
            "[]",
            '"a string"',
            "null",
            payload([], { schemaVersion: 2 }),
            payload([], { schemaVersion: "1" }),
            payload([], { mentions: "not an array" }),
        ]) {
            expect(hydrate(raw)).toEqual({ mentions: [], episodes: new Map() });
        }
    });

    it("refuses values that are not even text", () => {
        // A payload where the identifiers are numbers is not a payload with
        // unusual identifiers; it is not this control's payload.
        expect(
            hydrate(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceField: 7,
                    mentions: [],
                })
            ).mentions
        ).toEqual([]);
        expect(
            hydrate(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceField: FIELD,
                    mentions: [
                        { eventId: 7, recipientUserId: USER_A, occurrences: [] },
                    ],
                })
            ).mentions
        ).toEqual([]);
    });

    it("refuses a payload written for another column", () => {
        expect(hydrate(alexOnce, TEXT, "ayonto_notes").mentions).toEqual([]);
    });

    it("refuses an identifier that is not one this control writes", () => {
        for (const eventId of ["", "not-a-uuid", "11111111-2222-4333-8444", `${EVENT_A}-extra`]) {
            const raw = payload([
                { eventId, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
            ]);
            expect(hydrate(raw).mentions).toEqual([]);
        }
    });

    it("refuses a recipient nobody can be identified from", () => {
        // Whatever this is, it is not something to look up or to navigate to.
        for (const recipientUserId of [
            "   ",
            "u-alex",
            `${USER_A}-extra`,
            "aaaaaaaa-1111-2222-3333-44444444444",
            "../systemuser",
        ]) {
            const raw = payload([
                { eventId: EVENT_A, recipientUserId, occurrences: [{ start: 6, length: 12 }] },
            ]);

            expect(hydrate(raw).mentions).toEqual([]);
        }
    });

    it("refuses the same person claimed twice", () => {
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
            { eventId: EVENT_B, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
        ]);

        expect(hydrate(raw)).toEqual({ mentions: [], episodes: new Map() });
    });

    it("refuses two people claiming the same place", () => {
        // Each span reads as a whole mention on its own. One position cannot
        // speak for two people, and nothing says which of them it meant.
        const text = "@Alex Rivera and more";
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 12 }] },
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 0, length: 12 }] },
        ]);

        expect(hydrate(raw, text)).toEqual({ mentions: [], episodes: new Map() });
    });

    it("refuses two people whose places merely overlap", () => {
        // "@Alex Rivera" and, inside it, "@Alex" — which ends at a space and so
        // reads as a mention in its own right.
        const text = "@Alex Rivera and more";
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 12 }] },
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 0, length: 5 }] },
        ]);

        expect(hydrate(raw, text)).toEqual({ mentions: [], episodes: new Map() });
    });

    it("refuses one person claiming a place twice", () => {
        const text = "@Alex Rivera and more";
        const raw = payload([
            {
                eventId: EVENT_A,
                recipientUserId: USER_A,
                occurrences: [
                    { start: 0, length: 12 },
                    { start: 0, length: 12 },
                ],
            },
        ]);

        expect(hydrate(raw, text)).toEqual({ mentions: [], episodes: new Map() });
    });

    it("drops a span the text no longer supports, and keeps the rest", () => {
        // The second occurrence was edited away by somebody else.
        const raw = payload([
            {
                eventId: EVENT_A,
                recipientUserId: USER_A,
                occurrences: [
                    { start: 6, length: 12 },
                    { start: 900, length: 12 },
                ],
            },
        ]);

        expect(hydrate(raw).mentions).toHaveLength(1);
        expect([...hydrate(raw).episodes]).toEqual([[USER_A, EVENT_A]]);
    });

    it("ends an episode whose every span is gone", () => {
        // The name was deleted from the text; the payload still claims it.
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
        ]);

        expect(hydrate(raw, "The name is gone now")).toEqual({
            mentions: [],
            episodes: new Map(),
        });
    });

    it("refuses a span that stops in the middle of what the text says", () => {
        // Somebody typed on: the name is now "Alex RiveraX". Drawing the first
        // twelve characters as a person would show a name the text has not got.
        expect(hydrate(alexOnce, "Hello @Alex RiveraX today").mentions).toEqual([]);
    });

    it("takes a span that ends where a mention may end", () => {
        for (const [text, following] of [
            ["Hello @Alex Rivera today", "a space"],
            ["Hello @Alex Rivera, today", "a comma"],
            ["Hello @Alex Rivera.", "a full stop"],
            ["Hello @Alex Rivera)", "a bracket"],
            ["Hello @Alex Rivera\nand on", "a line break"],
            ["Hello @Alex Rivera", "the end of the text"],
        ]) {
            expect({ following, mentions: hydrate(alexOnce, text).mentions }).toEqual({
                following,
                mentions: [{ start: 6, name: "Alex Rivera", userId: USER_A }],
            });
        }
    });

    it("refuses a span that runs into the next word", () => {
        for (const text of [
            "Hello @Alex Rivera-Smith today",
            "Hello @Alex Riveras today",
            "Hello @Alex Rivera/2 today",
        ]) {
            expect(hydrate(alexOnce, text).mentions).toEqual([]);
        }
    });

    it("refuses an @ that could never have started a mention", () => {
        // The "@" of an address is not a trigger, so nothing there was ever a
        // mention, whatever a payload says about it.
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 4, length: 12 }] },
        ]);

        expect(hydrate(raw, "mail@Alex Rivera today").mentions).toEqual([]);
    });

    it("refuses a span written across a line break", () => {
        // A mention is never written across one, so a span that covers one
        // cannot be describing a mention this control made.
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
        ]);

        expect(hydrate(raw, "Hello @Alex\nRivera today").mentions).toEqual([]);
    });

    it("refuses a span that does not begin at an @", () => {
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 7, length: 12 }] },
        ]);

        expect(hydrate(raw).mentions).toEqual([]);
    });

    it("refuses spans that are not whole numbers, or make no sense", () => {
        for (const occurrence of [
            { start: 6.5, length: 12 },
            { start: 6, length: 12.5 },
            { start: -1, length: 12 },
            { start: 6, length: 1 },
            { start: 6, length: 0 },
            { start: 6, length: -3 },
            { start: 6, length: 999 },
        ] as Span[]) {
            const raw = payload([
                { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [occurrence] },
            ]);
            expect(hydrate(raw).mentions).toEqual([]);
        }
    });

    it("refuses a span that is not a span at all", () => {
        for (const occurrence of ["6,12", null, [], { start: "6", length: "12" }]) {
            const raw = payload([
                {
                    eventId: EVENT_A,
                    recipientUserId: USER_A,
                    occurrences: [occurrence as unknown as Span],
                },
            ]);
            expect(hydrate(raw).mentions).toEqual([]);
        }
    });

    it("refuses an event that is not an object, or carries no occurrence list", () => {
        expect(hydrate(JSON.stringify({ schemaVersion: 1, sourceField: FIELD, mentions: ["x"] })))
            .toEqual({ mentions: [], episodes: new Map() });
        expect(
            hydrate(
                JSON.stringify({
                    schemaVersion: 1,
                    sourceField: FIELD,
                    mentions: [{ eventId: EVENT_A, recipientUserId: USER_A }],
                })
            )
        ).toEqual({ mentions: [], episodes: new Map() });
    });

    it("never turns ordinary text into a person", () => {
        // A payload that names nobody leaves a hand-typed name exactly as it is.
        expect(hydrate(payload([])).mentions).toEqual([]);
    });

    it("reports the mentions in text order", () => {
        const text = "@Alex Rivera and @Robin Fox ";
        const raw = payload([
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 17, length: 10 }] },
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 12 }] },
        ]);

        expect(hydrate(raw, text).mentions.map((mention) => mention.start)).toEqual([0, 17]);
    });
});
