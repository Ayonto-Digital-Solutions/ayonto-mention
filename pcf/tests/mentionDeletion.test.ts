import { mentionDeletionRange, mentionSpan } from "../src/domain/mentionText";
import type { InsertedMention } from "../src/domain/mentionText";

/** Fictional people. Two of them deliberately share a display name. */
const alex: InsertedMention = { start: 3, name: "Alex Rivera", userId: "u-alex" };
const robinA: InsertedMention = { start: 0, name: "Robin Fox", userId: "id-a" };
const robinB: InsertedMention = { start: 15, name: "Robin Fox", userId: "id-b" };

/** "Hi @Alex Rivera thanks" — the mention runs from 3 to 15. */
const TEXT = `Hi @${alex.name} thanks`;

const back = (text: string, caret: number, mentions: readonly InsertedMention[]) =>
    mentionDeletionRange(text, caret, "backward", mentions);
const forward = (text: string, caret: number, mentions: readonly InsertedMention[]) =>
    mentionDeletionRange(text, caret, "forward", mentions);

describe("mentionSpan", () => {
    it("covers the @ and the name", () => {
        expect(mentionSpan(alex)).toEqual({ start: 3, end: 15 });
        expect(TEXT.slice(3, 15)).toBe("@Alex Rivera");
    });
});

describe("mentionDeletionRange", () => {
    it("takes the whole mention when Backspace sits right behind it", () => {
        expect(back(TEXT, 15, [alex])).toEqual({ start: 3, end: 16 });
    });

    it("takes the whole mention when Delete sits right in front of it", () => {
        expect(forward(TEXT, 3, [alex])).toEqual({ start: 3, end: 16 });
    });

    it("takes the whole mention from inside it, in either direction", () => {
        expect(back(TEXT, 9, [alex])).toEqual({ start: 3, end: 16 });
        expect(forward(TEXT, 9, [alex])).toEqual({ start: 3, end: 16 });
    });

    it("takes the space behind the mention, so no double space is left", () => {
        const range = back(TEXT, 15, [alex]);
        const remaining = TEXT.slice(0, range?.start) + TEXT.slice(range?.end);

        expect(remaining).toBe("Hi thanks");
    });

    it("leaves the space alone when the mention opens the text", () => {
        // Nothing in front of it, so removing the following space would run the
        // next word into the start of the line.
        const text = `@${robinA.name} please look`;

        const range = back(text, 10, [robinA]);

        expect(range).toEqual({ start: 0, end: 10 });
        expect(text.slice(0, 0) + text.slice(10)).toBe(" please look");
    });

    it("leaves the key alone when Backspace sits in front of the mention", () => {
        // Deleting there takes the character before the name, as it always would.
        expect(back(TEXT, 3, [alex])).toBeNull();
    });

    it("leaves the key alone when Delete sits behind the mention", () => {
        expect(forward(TEXT, 15, [alex])).toBeNull();
    });

    it("leaves ordinary text alone", () => {
        expect(back(TEXT, 20, [alex])).toBeNull();
        expect(forward(TEXT, 1, [alex])).toBeNull();
    });

    it("does not touch a name that was only typed", () => {
        // Nothing is tracked here, so the text is just text.
        expect(back(TEXT, 9, [])).toBeNull();
        expect(forward(TEXT, 9, [])).toBeNull();
    });

    it("takes only the mention the caret is in when two namesakes stand there", () => {
        const text = `@${robinA.name} and @${robinB.name} `;

        expect(back(text, 10, [robinA, robinB])).toEqual({ start: 0, end: 10 });
        expect(back(text, 24, [robinA, robinB])).toEqual({ start: 15, end: 26 });
    });

    it("finds the mention whichever order the tracked ones arrive in", () => {
        const text = `@${robinA.name} and @${robinB.name} `;

        expect(back(text, 24, [robinB, robinA])).toEqual({ start: 15, end: 26 });
    });
});
