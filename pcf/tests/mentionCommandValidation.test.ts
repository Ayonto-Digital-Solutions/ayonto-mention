import { MENTION_COMMAND_SCHEMA_VERSION } from "../src/domain/mentionCommand";
import type {
    AddMentionAction,
    MentionCommandAction,
    MentionCommandEnvelopeV1,
    MentionCommandOccurrence,
} from "../src/domain/mentionCommand";
import { validateMentionCommand } from "../src/domain/mentionCommandValidation";
import type { MentionCommandRejection } from "../src/domain/mentionCommandValidation";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const EVENT_ONE = "33333333-3333-4333-8333-333333333333";
const EVENT_TWO = "44444444-4444-4444-8444-444444444444";
const COMMAND_ID = "0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e";
const RECORD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** "@Robin Fox" at index 3, ten characters long, in a text of 27. */
const ONE_MENTION = "Hi @Robin Fox, please look.";
/** The same person at index 3 and again at index 18, in a text of 35. */
const TWO_MENTIONS = "Hi @Robin Fox and @Robin Fox again.";

/**
 * Envelopes are assembled by hand here rather than through the builders.
 *
 * The builders normalize what they are given, which is the right thing for them
 * to do and the wrong thing for these tests: what is being checked is that a
 * command which reached validation in a bad state is refused, however it got
 * there.
 */
function envelope(
    action: MentionCommandAction,
    overrides: Partial<MentionCommandEnvelopeV1> = {}
): MentionCommandEnvelopeV1 {
    return {
        schemaVersion: MENTION_COMMAND_SCHEMA_VERSION,
        commandId: COMMAND_ID,
        recordTable: "account",
        recordId: RECORD_ID,
        sourceField: "description",
        expectedFieldRevision: 4,
        expectedSourceText: "Hi , please look.",
        desiredSourceText: ONE_MENTION,
        action,
        ...overrides,
    };
}

const addition = (
    occurrences: readonly MentionCommandOccurrence[] = [{ start: 3, length: 10 }],
    overrides: Partial<AddMentionAction> = {}
): MentionCommandAction => ({
    kind: "AddMention",
    eventId: EVENT_ONE,
    recipientUserId: USER_A,
    occurrences,
    ...overrides,
});

/** The rejections, or a failure that says the command was unexpectedly accepted. */
function rejectionsOf(command: MentionCommandEnvelopeV1): readonly MentionCommandRejection[] {
    const verdict = validateMentionCommand(command);
    return verdict.ok ? [] : verdict.rejections;
}

describe("validateMentionCommand: what it accepts", () => {
    it("accepts a well-formed addition", () => {
        expect(validateMentionCommand(envelope(addition()))).toEqual({ ok: true });
    });

    it("accepts a well-formed removal", () => {
        expect(
            validateMentionCommand(
                envelope(
                    { kind: "RemoveMention", eventId: EVENT_ONE, recipientUserId: USER_A },
                    { expectedSourceText: ONE_MENTION, desiredSourceText: "Hi , please look." }
                )
            )
        ).toEqual({ ok: true });
    });

    it("accepts a well-formed replacement", () => {
        expect(
            validateMentionCommand(
                envelope(
                    {
                        kind: "ReplaceRecipient",
                        previousEventId: EVENT_ONE,
                        previousRecipientUserId: USER_A,
                        nextEventId: EVENT_TWO,
                        nextRecipientUserId: USER_B,
                        occurrences: [{ start: 3, length: 10 }],
                    },
                    { expectedSourceText: ONE_MENTION }
                )
            )
        ).toEqual({ ok: true });
    });

    it("accepts one person named in several places", () => {
        expect(
            validateMentionCommand(
                envelope(
                    addition([
                        { start: 3, length: 10 },
                        { start: 18, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual({ ok: true });
    });

    it("accepts a revision of zero", () => {
        expect(
            validateMentionCommand(envelope(addition(), { expectedFieldRevision: 0 }))
        ).toEqual({ ok: true });
    });

    it("accepts a mention that ends exactly at the end of the text", () => {
        // "Hi @Robin Fox" is thirteen characters: the span reaches the last one.
        expect(
            validateMentionCommand(
                envelope(addition([{ start: 3, length: 10 }]), { desiredSourceText: "Hi @Robin Fox" })
            )
        ).toEqual({ ok: true });
    });
});

describe("validateMentionCommand: the envelope", () => {
    it("refuses a schema version it does not know", () => {
        expect(rejectionsOf(envelope(addition(), { schemaVersion: 2 }))).toEqual([
            "unsupported-schema-version",
        ]);
    });

    it("refuses a schema version from before this one", () => {
        expect(rejectionsOf(envelope(addition(), { schemaVersion: 0 }))).toEqual([
            "unsupported-schema-version",
        ]);
    });

    it.each([
        ["not a guid at all", "robin-fox"],
        ["still wearing its braces", `{${COMMAND_ID}}`],
        ["upper case", COMMAND_ID.toUpperCase()],
        ["empty", ""],
        ["a guid with a character too many", `${COMMAND_ID}f`],
    ])("refuses a command id that is %s", (_description, commandId) => {
        expect(rejectionsOf(envelope(addition(), { commandId }))).toEqual([
            "malformed-command-id",
        ]);
    });

    it("refuses a malformed record id", () => {
        expect(rejectionsOf(envelope(addition(), { recordId: "account-42" }))).toEqual([
            "malformed-record-id",
        ]);
    });

    it.each([
        ["empty", ""],
        ["not lower case", "Account"],
        ["padded", " account "],
    ])("refuses a record table that is %s", (_description, recordTable) => {
        expect(rejectionsOf(envelope(addition(), { recordTable }))).toEqual([
            "malformed-record-table",
        ]);
    });

    it("refuses a malformed source field", () => {
        expect(rejectionsOf(envelope(addition(), { sourceField: "Description" }))).toEqual([
            "malformed-source-field",
        ]);
    });

    it.each([
        ["negative", -1],
        ["fractional", 1.5],
        ["not a number", Number.NaN],
        ["infinite", Number.POSITIVE_INFINITY],
    ])("refuses a revision that is %s", (_description, expectedFieldRevision) => {
        expect(rejectionsOf(envelope(addition(), { expectedFieldRevision }))).toEqual([
            "invalid-field-revision",
        ]);
    });

    it("reports every reason rather than only the first", () => {
        expect(
            rejectionsOf(
                envelope(addition(), {
                    schemaVersion: 7,
                    commandId: "nope",
                    recordId: "nope",
                    expectedFieldRevision: -3,
                })
            )
        ).toEqual([
            "unsupported-schema-version",
            "malformed-command-id",
            "malformed-record-id",
            "invalid-field-revision",
        ]);
    });
});

describe("validateMentionCommand: identity", () => {
    it("refuses an addition whose event id is malformed", () => {
        expect(rejectionsOf(envelope(addition(undefined, { eventId: "episode-1" })))).toEqual([
            "malformed-event-id",
        ]);
    });

    it("refuses an addition whose recipient is not a user id", () => {
        expect(
            rejectionsOf(envelope(addition(undefined, { recipientUserId: "Robin Fox" })))
        ).toEqual(["malformed-recipient-id"]);
    });

    it("refuses a recipient given as an address", () => {
        // An address is not an identity, and a validator that took one would be
        // the place the rule quietly stopped applying.
        expect(
            rejectionsOf(
                envelope(addition(undefined, { recipientUserId: "robin.fox@example.invalid" }))
            )
        ).toEqual(["malformed-recipient-id"]);
    });

    it("refuses a removal whose identities are malformed", () => {
        expect(
            rejectionsOf(
                envelope({ kind: "RemoveMention", eventId: "one", recipientUserId: "robin" })
            )
        ).toEqual(["malformed-event-id", "malformed-recipient-id"]);
    });

    it("refuses a replacement that does not change the person", () => {
        expect(
            rejectionsOf(
                envelope({
                    kind: "ReplaceRecipient",
                    previousEventId: EVENT_ONE,
                    previousRecipientUserId: USER_A,
                    nextEventId: EVENT_TWO,
                    nextRecipientUserId: USER_A,
                    occurrences: [{ start: 3, length: 10 }],
                })
            )
        ).toEqual(["unchanged-recipient"]);
    });

    it("refuses a replacement that hands the old episode id to the new recipient", () => {
        expect(
            rejectionsOf(
                envelope({
                    kind: "ReplaceRecipient",
                    previousEventId: EVENT_ONE,
                    previousRecipientUserId: USER_A,
                    nextEventId: EVENT_ONE,
                    nextRecipientUserId: USER_B,
                    occurrences: [{ start: 3, length: 10 }],
                })
            )
        ).toEqual(["reused-event-id"]);
    });

    it("refuses a replacement of somebody by themselves under the same episode", () => {
        expect(
            rejectionsOf(
                envelope({
                    kind: "ReplaceRecipient",
                    previousEventId: EVENT_ONE,
                    previousRecipientUserId: USER_A,
                    nextEventId: EVENT_ONE,
                    nextRecipientUserId: USER_A,
                    occurrences: [{ start: 3, length: 10 }],
                })
            )
        ).toEqual(["unchanged-recipient", "reused-event-id"]);
    });

    it("refuses a replacement whose identities are malformed", () => {
        expect(
            rejectionsOf(
                envelope({
                    kind: "ReplaceRecipient",
                    previousEventId: "before",
                    previousRecipientUserId: "Robin Fox",
                    nextEventId: EVENT_TWO,
                    nextRecipientUserId: USER_B,
                    occurrences: [{ start: 3, length: 10 }],
                })
            )
        ).toEqual(["malformed-event-id", "malformed-recipient-id"]);
    });
});

describe("validateMentionCommand: occurrences", () => {
    it("refuses an addition that names nowhere", () => {
        expect(rejectionsOf(envelope(addition([])))).toEqual(["empty-occurrences"]);
    });

    it("refuses a replacement that names nowhere", () => {
        expect(
            rejectionsOf(
                envelope({
                    kind: "ReplaceRecipient",
                    previousEventId: EVENT_ONE,
                    previousRecipientUserId: USER_A,
                    nextEventId: EVENT_TWO,
                    nextRecipientUserId: USER_B,
                    occurrences: [],
                })
            )
        ).toEqual(["empty-occurrences"]);
    });

    it.each([
        ["starting before the text", { start: -1, length: 10 }],
        ["reaching past the end", { start: 20, length: 10 }],
        ["starting past the end", { start: 99, length: 1 }],
        ["covering nothing", { start: 3, length: 0 }],
        ["of negative length", { start: 3, length: -2 }],
        ["at a fractional index", { start: 3.5, length: 10 }],
        ["of fractional length", { start: 3, length: 10.5 }],
    ])("refuses a span %s", (_description, occurrence) => {
        expect(rejectionsOf(envelope(addition([occurrence])))).toEqual([
            "occurrence-out-of-range",
        ]);
    });

    it("refuses spans that overlap each other", () => {
        expect(
            rejectionsOf(
                envelope(
                    addition([
                        { start: 3, length: 10 },
                        { start: 7, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual(["overlapping-occurrences"]);
    });

    it("refuses two spans that begin in the same place", () => {
        expect(
            rejectionsOf(
                envelope(
                    addition([
                        { start: 3, length: 10 },
                        { start: 3, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual(["overlapping-occurrences"]);
    });

    it("accepts spans that touch without overlapping", () => {
        expect(
            validateMentionCommand(
                envelope(
                    addition([
                        { start: 3, length: 10 },
                        { start: 13, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual({ ok: true });
    });

    it("refuses spans that are not in text order", () => {
        expect(
            rejectionsOf(
                envelope(
                    addition([
                        { start: 18, length: 10 },
                        { start: 3, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual(["unordered-occurrences"]);
    });

    it("reports order and overlap separately when a set is both", () => {
        expect(
            rejectionsOf(
                envelope(
                    addition([
                        { start: 7, length: 10 },
                        { start: 3, length: 10 },
                    ]),
                    { desiredSourceText: TWO_MENTIONS }
                )
            )
        ).toEqual(["unordered-occurrences", "overlapping-occurrences"]);
    });

    it("measures spans against the text the command wants to leave behind", () => {
        // The mention does not fit the text as it stands, and must not: that text
        // is the one without it. It fits the text the command is asking for.
        const command = envelope(addition([{ start: 3, length: 10 }]), {
            expectedSourceText: "Hi ",
            desiredSourceText: ONE_MENTION,
        });

        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });
});
