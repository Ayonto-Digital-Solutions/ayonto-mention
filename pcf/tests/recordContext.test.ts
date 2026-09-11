import { resolveRecordContext } from "../src/domain/recordContext";
import type { RecordContextInput } from "../src/domain/recordContext";

/** A complete, fictional context. */
const complete: RecordContextInput = {
    recordId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    recordTable: "account",
    sourceField: "description",
};

describe("resolveRecordContext", () => {
    it("accepts a record id that already has the expected shape", () => {
        expect(resolveRecordContext(complete)).toEqual({
            recordId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            recordTable: "account",
            sourceField: "description",
        });
    });

    it("strips the braces Dataverse puts around a record id", () => {
        expect(
            resolveRecordContext({
                ...complete,
                recordId: "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}",
            })?.recordId
        ).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    });

    it("lower-cases a record id", () => {
        expect(
            resolveRecordContext({ ...complete, recordId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE" })
        ).toEqual(complete);
    });

    it("strips braces and lower-cases in one go", () => {
        expect(
            resolveRecordContext({ ...complete, recordId: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" })
        ).toEqual(complete);
    });

    it("ignores surrounding whitespace on every part", () => {
        expect(
            resolveRecordContext({
                recordId: "  {AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}  ",
                recordTable: "  Account  ",
                sourceField: "  Description  ",
            })
        ).toEqual(complete);
    });

    it("lower-cases the table name", () => {
        expect(resolveRecordContext({ ...complete, recordTable: "AcCoUnT" })?.recordTable).toBe(
            "account"
        );
    });

    it("lower-cases the column name", () => {
        expect(resolveRecordContext({ ...complete, sourceField: "DeScRiPtIoN" })?.sourceField).toBe(
            "description"
        );
    });

    it("reports nothing to write against while the record has no id", () => {
        // A form for a record Dataverse has not saved yet.
        expect(resolveRecordContext({ ...complete, recordId: "" })).toBeNull();
        expect(resolveRecordContext({ ...complete, recordId: "   " })).toBeNull();
        expect(resolveRecordContext({ ...complete, recordId: null })).toBeNull();
        expect(resolveRecordContext({ ...complete, recordId: undefined })).toBeNull();
    });

    it("reports nothing to write against without a table", () => {
        expect(resolveRecordContext({ ...complete, recordTable: "" })).toBeNull();
        expect(resolveRecordContext({ ...complete, recordTable: "  " })).toBeNull();
        expect(resolveRecordContext({ ...complete, recordTable: null })).toBeNull();
    });

    it("reports nothing to write against without a column", () => {
        expect(resolveRecordContext({ ...complete, sourceField: "" })).toBeNull();
        expect(resolveRecordContext({ ...complete, sourceField: "  " })).toBeNull();
        expect(resolveRecordContext({ ...complete, sourceField: undefined })).toBeNull();
    });

    it("treats braces alone as no id at all", () => {
        expect(resolveRecordContext({ ...complete, recordId: "{}" })).toBeNull();
    });

    it("keeps braces that sit inside the value", () => {
        // Only the wrapper Dataverse adds is removed. Stripping every brace would
        // quietly rewrite a value that merely contains one.
        expect(resolveRecordContext({ ...complete, recordId: "abc{def}" })?.recordId).toBe(
            "abc{def}"
        );
    });

    it("keeps an unmatched opening brace", () => {
        expect(resolveRecordContext({ ...complete, recordId: "{abc" })?.recordId).toBe("{abc");
    });

    it("keeps an unmatched closing brace", () => {
        expect(resolveRecordContext({ ...complete, recordId: "abc}" })?.recordId).toBe("abc}");
    });

    it("removes only one surrounding pair", () => {
        expect(resolveRecordContext({ ...complete, recordId: "{abc{def}}" })?.recordId).toBe(
            "abc{def}"
        );
    });

    it("keeps a lone brace as the value it is", () => {
        expect(resolveRecordContext({ ...complete, recordId: "{" })?.recordId).toBe("{");
    });

    it("leaves the input it was given untouched", () => {
        const input: RecordContextInput = {
            recordId: "  {AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}  ",
            recordTable: "  Account  ",
            sourceField: "  Description  ",
        };
        const snapshot = { ...input };

        resolveRecordContext(input);

        expect(input).toEqual(snapshot);
    });
});
