import {
    DEFAULT_FIELD_ROWS,
    MAX_FIELD_ROWS,
    MIN_FIELD_ROWS,
    clampFieldRows,
} from "../src/domain/fieldRows";

describe("clampFieldRows", () => {
    it("falls back to three rows when nothing was configured", () => {
        expect(clampFieldRows(null)).toBe(3);
        expect(clampFieldRows(undefined)).toBe(3);
        expect(DEFAULT_FIELD_ROWS).toBe(3);
    });

    it("takes a row count the maker can reasonably want", () => {
        expect(clampFieldRows(1)).toBe(1);
        expect(clampFieldRows(3)).toBe(3);
        expect(clampFieldRows(5)).toBe(5);
        expect(clampFieldRows(30)).toBe(30);
    });

    it("keeps a field tall enough to hold a line of text", () => {
        // A maker types into a plain number box, so zero is one keystroke away.
        expect(clampFieldRows(0)).toBe(MIN_FIELD_ROWS);
        expect(clampFieldRows(-4)).toBe(MIN_FIELD_ROWS);
        expect(MIN_FIELD_ROWS).toBe(1);
    });

    it("keeps a field from swallowing the form", () => {
        expect(clampFieldRows(31)).toBe(MAX_FIELD_ROWS);
        expect(clampFieldRows(500)).toBe(MAX_FIELD_ROWS);
        expect(MAX_FIELD_ROWS).toBe(30);
    });

    it("clamps rather than giving up on a value that was meant", () => {
        // 90 is a tall field asked for clumsily, not a value with no intent
        // behind it. The tallest available field is closer to what was wanted
        // than the default would be.
        expect(clampFieldRows(90)).toBe(30);
        expect(clampFieldRows(0.4)).toBe(1);
    });

    it("rounds a value that is not a whole number of rows", () => {
        expect(clampFieldRows(4.4)).toBe(4);
        expect(clampFieldRows(4.6)).toBe(5);
    });

    it("falls back for anything that is not a number of rows at all", () => {
        // The test harness hands over strings, a misconfigured host may hand over
        // anything, and none of it is an intention to honour.
        for (const unusable of [Number.NaN, Infinity, -Infinity, "5", "", {}, [], true]) {
            expect(clampFieldRows(unusable)).toBe(DEFAULT_FIELD_ROWS);
        }
    });
});
