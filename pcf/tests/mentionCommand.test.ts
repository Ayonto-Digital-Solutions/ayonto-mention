import * as commandDomain from "../src/domain/mentionCommand";
import {
    MENTION_COMMAND_SCHEMA_VERSION,
    buildAddMentionCommand,
    buildRemoveMentionCommand,
    buildReplaceRecipientCommand,
    serializeMentionCommand,
} from "../src/domain/mentionCommand";
import type { AddMentionAction, MentionCommandScope } from "../src/domain/mentionCommand";
import { validateMentionCommand } from "../src/domain/mentionCommandValidation";
import type { MentionRecordContext } from "../src/domain/recordContext";

/**
 * Fictional identities. Two of them are the namesakes: different people, and the
 * text that names them is the same down to the byte.
 */
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const EVENT_ONE = "33333333-3333-4333-8333-333333333333";
const EVENT_TWO = "44444444-4444-4444-8444-444444444444";
const COMMAND_ID = "0a0a0a0a-0b0b-4c0c-8d0d-0e0e0e0e0e0e";

const context: MentionRecordContext = {
    recordId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    recordTable: "account",
    sourceField: "description",
};

/** "@Robin Fox" starts at index 3 and is ten characters long. */
const ONE_MENTION = "Hi @Robin Fox, please look.";
/** The same person named twice: at index 3 and again at index 18. */
const TWO_MENTIONS = "Hi @Robin Fox and @Robin Fox again.";

const scope: MentionCommandScope = {
    commandId: COMMAND_ID,
    context,
    expectedFieldRevision: 4,
    expectedSourceText: "Hi , please look.",
    desiredSourceText: ONE_MENTION,
};

describe("buildAddMentionCommand", () => {
    it("states the record, the revision and both texts", () => {
        const command = buildAddMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });

        expect(command).toEqual({
            schemaVersion: MENTION_COMMAND_SCHEMA_VERSION,
            commandId: COMMAND_ID,
            recordTable: "account",
            recordId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            sourceField: "description",
            expectedFieldRevision: 4,
            expectedSourceText: "Hi , please look.",
            desiredSourceText: ONE_MENTION,
            action: {
                kind: "AddMention",
                eventId: EVENT_ONE,
                recipientUserId: USER_A,
                occurrences: [{ start: 3, length: 10 }],
            },
        });
        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });

    it("normalizes the ids it is handed, braces and case alike", () => {
        const command = buildAddMentionCommand(
            { ...scope, commandId: `{${COMMAND_ID.toUpperCase()}}` },
            {
                eventId: EVENT_ONE.toUpperCase(),
                recipientUserId: `{${USER_A}}`,
                occurrences: [{ start: 3, length: 10 }],
            }
        );

        expect(command.commandId).toBe(COMMAND_ID);
        expect(command.action).toMatchObject({ eventId: EVENT_ONE, recipientUserId: USER_A });
        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });

    it("carries every place one person is named, in text order", () => {
        const command = buildAddMentionCommand(
            { ...scope, desiredSourceText: TWO_MENTIONS },
            {
                eventId: EVENT_ONE,
                recipientUserId: USER_A,
                // Handed over out of order on purpose: one episode, two places.
                occurrences: [
                    { start: 18, length: 10 },
                    { start: 3, length: 10 },
                ],
            }
        );

        expect((command.action as AddMentionAction).occurrences).toEqual([
            { start: 3, length: 10 },
            { start: 18, length: 10 },
        ]);
        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });
});

describe("buildRemoveMentionCommand", () => {
    it("names the episode that ends and carries no occurrences", () => {
        const command = buildRemoveMentionCommand(
            { ...scope, expectedSourceText: ONE_MENTION, desiredSourceText: "Hi , please look." },
            { eventId: EVENT_ONE, recipientUserId: USER_A }
        );

        expect(command.action).toEqual({
            kind: "RemoveMention",
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
        });
        expect(command.action).not.toHaveProperty("occurrences");
        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });
});

describe("buildReplaceRecipientCommand", () => {
    /**
     * The case the architecture exists for: two people called Robin Fox, the
     * editor swaps one for the other, and the text does not change by a byte.
     */
    const namesakeScope: MentionCommandScope = {
        ...scope,
        expectedSourceText: ONE_MENTION,
        desiredSourceText: ONE_MENTION,
    };

    const namesakeSwap = () =>
        buildReplaceRecipientCommand(namesakeScope, {
            previousEventId: EVENT_ONE,
            previousRecipientUserId: USER_A,
            nextEventId: EVENT_TWO,
            nextRecipientUserId: USER_B,
            occurrences: [{ start: 3, length: 10 }],
        });

    it("replaces the person behind byte-identical visible text", () => {
        const command = namesakeSwap();

        expect(command.expectedSourceText).toBe(command.desiredSourceText);
        expect(command.action).toEqual({
            kind: "ReplaceRecipient",
            previousEventId: EVENT_ONE,
            previousRecipientUserId: USER_A,
            nextEventId: EVENT_TWO,
            nextRecipientUserId: USER_B,
            occurrences: [{ start: 3, length: 10 }],
        });
        expect(validateMentionCommand(command)).toEqual({ ok: true });
    });

    it("keeps the two recipients distinct", () => {
        const command = namesakeSwap();

        expect(command.action).toMatchObject({
            previousRecipientUserId: USER_A,
            nextRecipientUserId: USER_B,
        });
        expect(USER_A).not.toBe(USER_B);
    });

    it("begins a new episode rather than handing the old id to the new recipient", () => {
        const command = namesakeSwap();

        expect(command.action).toMatchObject({
            previousEventId: EVENT_ONE,
            nextEventId: EVENT_TWO,
        });
        expect(EVENT_ONE).not.toBe(EVENT_TWO);
    });

    it("refuses to let equal visible text stand in for a replacement", () => {
        // Same text, same person, two fresh episode ids: nothing was replaced.
        // The builder assembles it; validation is what says it means nothing.
        const command = buildReplaceRecipientCommand(namesakeScope, {
            previousEventId: EVENT_ONE,
            previousRecipientUserId: USER_A,
            nextEventId: EVENT_TWO,
            nextRecipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });

        expect(validateMentionCommand(command)).toEqual({
            ok: false,
            rejections: ["unchanged-recipient"],
        });
    });
});

describe("serializeMentionCommand", () => {
    it("writes the envelope the server reads", () => {
        const command = buildAddMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });

        expect(JSON.parse(serializeMentionCommand(command))).toEqual({
            schemaVersion: 1,
            commandId: COMMAND_ID,
            recordTable: "account",
            recordId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            sourceField: "description",
            expectedFieldRevision: 4,
            expectedSourceText: "Hi , please look.",
            desiredSourceText: ONE_MENTION,
            action: {
                kind: "AddMention",
                eventId: EVENT_ONE,
                recipientUserId: USER_A,
                occurrences: [{ start: 3, length: 10 }],
            },
        });
    });

    it("writes the same string for the same command", () => {
        const once = buildAddMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });
        const again = buildAddMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });

        expect(serializeMentionCommand(once)).toBe(serializeMentionCommand(again));
    });

    it("carries the text verbatim, because the text is the record's and not a leak", () => {
        // The source text holds whatever the author wrote, names included. That is
        // the column's own content travelling to the column it came from, and it is
        // the one place a name legitimately appears. What must never travel is a
        // name presented as an *identity*, which is what the next test is about.
        const command = buildAddMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 10 }],
        });

        expect(serializeMentionCommand(command)).toContain(ONE_MENTION);
    });

    it("writes no name, address, URL or environment a caller carries alongside", () => {
        // The payload is written by whoever may write the text. Nothing personal
        // and nothing forgeable reaches it, however it is smuggled in. The text
        // here deliberately does not spell the display name out, so that finding
        // the name in the payload can only mean it came in as identity.
        const initials: MentionCommandScope = {
            ...scope,
            expectedSourceText: "Hi , look.",
            desiredSourceText: "Hi @R.F., look.",
        };
        const command = buildAddMentionCommand(initials, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
            occurrences: [{ start: 3, length: 5, label: "@R.F." }],
        } as unknown as Parameters<typeof buildAddMentionCommand>[1]);

        const smuggled = {
            ...command,
            action: {
                ...command.action,
                recipientName: "Robin Fox",
                recipientEmail: "private.address@example.invalid",
            },
            recordUrl: "https://contoso.crm4.dynamics.com/main.aspx?id=1",
            organizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            tenantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        } as unknown as typeof command;

        const written = serializeMentionCommand(smuggled);

        for (const leaked of [
            "Robin Fox",
            "recipientName",
            "private.address@example.invalid",
            "dynamics.com",
            "recordUrl",
            "organizationId",
            "tenantId",
            "label",
        ]) {
            expect(written).not.toContain(leaked);
        }
    });

    it("writes each action with only the fields that action has", () => {
        const removal = buildRemoveMentionCommand(scope, {
            eventId: EVENT_ONE,
            recipientUserId: USER_A,
        });
        const replacement = buildReplaceRecipientCommand(scope, {
            previousEventId: EVENT_ONE,
            previousRecipientUserId: USER_A,
            nextEventId: EVENT_TWO,
            nextRecipientUserId: USER_B,
            occurrences: [{ start: 3, length: 10 }],
        });

        const actionKeys = (command: typeof removal): string[] =>
            Object.keys(
                (JSON.parse(serializeMentionCommand(command)) as { action: Record<string, unknown> })
                    .action
            ).sort();

        expect(actionKeys(removal)).toEqual(["eventId", "kind", "recipientUserId"]);
        expect(actionKeys(replacement)).toEqual([
            "kind",
            "nextEventId",
            "nextRecipientUserId",
            "occurrences",
            "previousEventId",
            "previousRecipientUserId",
        ]);
    });
});

describe("the command domain's surface", () => {
    /**
     * Ordinary typing is not a command, and there is deliberately no way here to
     * turn it into one. Every builder demands the identities explicitly; nothing
     * in this module accepts text and returns a command, so no amount of typing
     * can produce one by itself.
     *
     * This list is the guard. The day somebody adds an `inferCommandFromText`,
     * this test fails and the reason above gets read again.
     */
    it("offers no way to derive a command from text", () => {
        expect(Object.keys(commandDomain).sort()).toEqual([
            "MENTION_COMMAND_SCHEMA_VERSION",
            "buildAddMentionCommand",
            "buildRemoveMentionCommand",
            "buildReplaceRecipientCommand",
            "serializeMentionCommand",
        ]);
    });
});
