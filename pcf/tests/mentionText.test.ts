import {
    MAX_QUERY_LENGTH,
    applyMention,
    findMentionTrigger,
    reanchorMentions,
    splitMentions,
} from "../src/domain/mentionText";
import type { MentionTrigger } from "../src/domain/mentionText";

/** Resolves a trigger or fails loudly, so the tests need no non-null assertions. */
function triggerAt(text: string, caret: number): MentionTrigger {
    const trigger = findMentionTrigger(text, caret);
    if (trigger === null) {
        throw new Error(`expected a mention trigger in ${JSON.stringify(text)} at ${caret}`);
    }
    return trigger;
}

describe("findMentionTrigger", () => {
    it("finds a trigger at the start of the text", () => {
        expect(findMentionTrigger("@Ale", 4)).toEqual({ start: 0, end: 4, query: "Ale" });
    });

    it("finds a trigger that follows whitespace", () => {
        expect(findMentionTrigger("hi @Ale", 7)).toEqual({ start: 3, end: 7, query: "Ale" });
    });

    it("allows one space inside the query, because user names contain one", () => {
        expect(findMentionTrigger("cc @Alex Riv", 12)).toEqual({
            start: 3,
            end: 12,
            query: "Alex Riv",
        });
    });

    it("stops at a second space, so the query cannot swallow the sentence", () => {
        expect(findMentionTrigger("cc @Alex and please look", 24)).toBeNull();
    });

    it("closes on a trailing space, so a finished mention stops searching", () => {
        expect(findMentionTrigger("cc @Alex Rivera ", 16)).toBeNull();
    });

    it("ignores an @ that is glued to a word, so e-mail addresses do not trigger it", () => {
        expect(findMentionTrigger("mail alex@example", 17)).toBeNull();
    });

    it("does not look across a line break", () => {
        expect(findMentionTrigger("@Ale\nmore", 9)).toBeNull();
    });

    it("gives up once the query grows past the maximum length", () => {
        const text = `@${"x".repeat(MAX_QUERY_LENGTH + 5)}`;
        expect(findMentionTrigger(text, text.length)).toBeNull();
    });

    it("returns null when there is no @ at all", () => {
        expect(findMentionTrigger("plain text", 10)).toBeNull();
    });

    it("uses the @ closest to the caret", () => {
        expect(findMentionTrigger("@Da @Al", 7)).toEqual({ start: 4, end: 7, query: "Al" });
    });

    it("returns null for a caret outside the text", () => {
        expect(findMentionTrigger("@Ale", 99)).toBeNull();
    });
});

describe("applyMention", () => {
    it("replaces the query with the full name and appends a separating space", () => {
        expect(applyMention("hi @Al", triggerAt("hi @Al", 6), "Alex Rivera")).toEqual({
            text: "hi @Alex Rivera ",
            caret: 16,
        });
    });

    it("keeps whatever followed the caret", () => {
        expect(applyMention("hi @Al, bye", triggerAt("hi @Al, bye", 6), "Alex Rivera").text).toBe(
            "hi @Alex Rivera , bye"
        );
    });

    it("does not add a second space when one is already there", () => {
        // The caret goes behind that space, not in front of it: typing on from
        // there has to continue the sentence rather than run into the name.
        expect(applyMention("hi @Al bye", triggerAt("hi @Al bye", 6), "Alex Rivera")).toEqual({
            text: "hi @Alex Rivera bye",
            caret: 16,
        });
    });

    it("leaves the caret behind the space it wrote itself", () => {
        const result = applyMention("hi @Al", triggerAt("hi @Al", 6), "Alex Rivera");
        expect(result.text.slice(0, result.caret)).toBe("hi @Alex Rivera ");
    });
});

describe("reanchorMentions", () => {
    it("moves a mention along when text is inserted in front of it", () => {
        expect(
            reanchorMentions(
                [{ start: 3, name: "Dana", userId: "u-dana" }],
                "hi @Dana ",
                "hi there @Dana "
            )
        ).toEqual([{ start: 9, name: "Dana", userId: "u-dana" }]);
    });

    it("leaves a mention that did not move where it is", () => {
        expect(
            reanchorMentions(
                [{ start: 3, name: "Dana", userId: "u-dana" }],
                "hi @Dana ",
                "hi @Dana thanks"
            )
        ).toEqual([{ start: 3, name: "Dana", userId: "u-dana" }]);
    });

    it("forgets a mention that is no longer in the text", () => {
        expect(
            reanchorMentions([{ start: 3, name: "Dana", userId: "u-dana" }], "hi @Dana ", "hi thanks")
        ).toEqual([]);
    });

    it("forgets a mention the edit wrote into", () => {
        // "@Dana" with an "s" typed onto it is a mention of nobody, so whoever it
        // stood for is no longer mentioned — and a notification still waiting for
        // them must not go out.
        expect(
            reanchorMentions(
                [{ start: 3, name: "Dana", userId: "u-dana" }],
                "hi @Dana ",
                "hi @Danas "
            )
        ).toEqual([]);
    });

    it("does not mistake a longer name for the one it is looking for", () => {
        expect(
            reanchorMentions([{ start: 0, name: "Dana", userId: "u-dana" }], "@Dana ", "@Danae Cole ")
        ).toEqual([]);
    });

    it("keeps two mentions of the same person apart when one edit moves both", () => {
        // Picking a suggestion inserts a whole name at once, and it starts with the
        // same "@" it is placed in front of — so the change alone cannot say where
        // it begins. Losing a record here would leave that mention unguarded.
        const anchored = reanchorMentions(
            [
                { start: 0, name: "Dana", userId: "u-dana" },
                { start: 6, name: "Dana", userId: "u-dana" },
            ],
            "@Dana @Dana ",
            "@Alex Rivera @Dana @Dana "
        );

        expect(anchored.map((mention) => mention.start)).toEqual([13, 19]);
    });

    it("does not let a short name take the mention of a longer one", () => {
        // "@Dana Winter" also reads as a mention of "Dana" followed by a space.
        const anchored = reanchorMentions(
            [
                { start: 0, name: "Dana Winter", userId: "u-dana-winter" },
                { start: 13, name: "Dana", userId: "u-dana" },
            ],
            "@Dana Winter @Dana ",
            "@Alex Rivera @Dana Winter @Dana "
        );

        expect(anchored).toEqual([
            { start: 13, name: "Dana Winter", userId: "u-dana-winter" },
            { start: 26, name: "Dana", userId: "u-dana" },
        ]);
    });

    it("keeps two mentions of the same person apart", () => {
        const anchored = reanchorMentions(
            [
                { start: 0, name: "Dana", userId: "u-dana" },
                { start: 10, name: "Dana", userId: "u-dana" },
            ],
            "@Dana and @Dana ",
            "cc @Dana and @Dana "
        );

        expect(anchored).toEqual([
            { start: 3, name: "Dana", userId: "u-dana" },
            { start: 13, name: "Dana", userId: "u-dana" },
        ]);
    });

    it("drops the namesake who was deleted, not the one still in the text", () => {
        // Two people share a display name, both are mentioned, and the FIRST
        // mention is deleted. The text left behind is the same either way, so
        // looking the name up again handed the surviving mention to the deleted
        // person — and notified them instead of the other.
        const anchored = reanchorMentions(
            [
                { start: 6, name: "Robin Fox", userId: "id-a" },
                { start: 21, name: "Robin Fox", userId: "id-b" },
            ],
            "Hello @Robin Fox and @Robin Fox ",
            "Hello and @Robin Fox "
        );

        expect(anchored).toEqual([{ start: 10, name: "Robin Fox", userId: "id-b" }]);
    });

    it("drops the right namesake when the second mention is the one deleted", () => {
        const anchored = reanchorMentions(
            [
                { start: 6, name: "Robin Fox", userId: "id-a" },
                { start: 21, name: "Robin Fox", userId: "id-b" },
            ],
            "Hello @Robin Fox and @Robin Fox ",
            "Hello @Robin Fox and "
        );

        expect(anchored).toEqual([{ start: 6, name: "Robin Fox", userId: "id-a" }]);
    });
});

describe("splitMentions", () => {
    const users = new Map([
        ["Alex Rivera", "u1"],
        ["Dana", "u2"],
        ["Dana Winter", "u3"],
    ]);

    it("keeps text without mentions in one piece", () => {
        expect(splitMentions("nothing to see", users)).toEqual([{ text: "nothing to see" }]);
    });

    it("returns the text unchanged while no names are known yet", () => {
        // The editor renders before the user lookup has resolved.
        expect(splitMentions("hi @Dana", new Map())).toEqual([{ text: "hi @Dana" }]);
    });

    it("returns nothing for empty text", () => {
        expect(splitMentions("", users)).toEqual([]);
    });

    it("marks a known name as a mention", () => {
        expect(splitMentions("hi @Alex Rivera, thanks", users)).toEqual([
            { text: "hi " },
            { text: "@Alex Rivera", userId: "u1" },
            { text: ", thanks" },
        ]);
    });

    it("leaves a name nobody could resolve as plain text", () => {
        expect(splitMentions("hi @Nils Vogel", users)).toEqual([{ text: "hi @Nils Vogel" }]);
    });

    it("prefers the longer name", () => {
        expect(splitMentions("@Dana Winter is here", users)).toEqual([
            { text: "@Dana Winter", userId: "u3" },
            { text: " is here" },
        ]);
    });

    it("does not read an e-mail address as a mention", () => {
        expect(splitMentions("mail@Dana now", users)).toEqual([{ text: "mail@Dana now" }]);
    });

    it("finds several mentions in one text", () => {
        expect(splitMentions("@Dana and @Alex Rivera", users)).toEqual([
            { text: "@Dana", userId: "u2" },
            { text: " and " },
            { text: "@Alex Rivera", userId: "u1" },
        ]);
    });

    it("lets the written mention decide between two namesakes", () => {
        // The name alone cannot tell the two apart, and a lookup map can only hold
        // one of them. The records the editor wrote carry the identity.
        expect(
            splitMentions("Hello @Robin Fox and @Robin Fox ", new Map([["Robin Fox", "u-fallback"]]), [
                { start: 6, name: "Robin Fox", userId: "id-a" },
                { start: 21, name: "Robin Fox", userId: "id-b" },
            ])
        ).toEqual([
            { text: "Hello " },
            { text: "@Robin Fox", userId: "id-a" },
            { text: " and " },
            { text: "@Robin Fox", userId: "id-b" },
            { text: " " },
        ]);
    });
});
