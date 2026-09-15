import {
    MENTION_METADATA_SCHEMA_VERSION,
    serializeMentionMetadata,
} from "../src/domain/mentionMetadata";
import type { MentionNotificationEvent } from "../src/domain/mentionMetadata";
import { createEventId } from "../src/services/eventId";

const alex: MentionNotificationEvent = {
    eventId: "event-alex",
    recipientUserId: "u-alex",
    occurrences: [{ start: 6, length: 12 }],
};
const dana: MentionNotificationEvent = {
    eventId: "event-dana",
    recipientUserId: "u-dana",
    occurrences: [{ start: 30, length: 12 }],
};

describe("serializeMentionMetadata", () => {
    it("writes the envelope the server reads", () => {
        expect(serializeMentionMetadata("description", [alex])).toBe(
            '{"schemaVersion":1,"sourceField":"description","mentions":' +
                '[{"eventId":"event-alex","recipientUserId":"u-alex",' +
                '"occurrences":[{"start":6,"length":12}]}]}'
        );
    });

    it("writes nothing about a person but who they are", () => {
        const written = JSON.parse(serializeMentionMetadata("description", [alex, dana])) as {
            mentions: Record<string, unknown>[];
        };

        expect(written.mentions.map((mention) => Object.keys(mention).sort())).toEqual([
            ["eventId", "occurrences", "recipientUserId"],
            ["eventId", "occurrences", "recipientUserId"],
        ]);
    });

    it("writes no name or address a caller carries alongside an event", () => {
        // The column sits on a business record and is written by whoever may
        // write the text. Nothing personal, and nothing forgeable, goes into it.
        const carried = {
            ...alex,
            recipientName: 'Robert"); DROP TABLE mentions; --',
            recipientEmail: "private.address@example.invalid",
            jobTitle: "Head of Something Confidential",
        } as MentionNotificationEvent;

        const written = serializeMentionMetadata("description", [carried]);

        expect(written).toBe(
            '{"schemaVersion":1,"sourceField":"description","mentions":' +
                '[{"eventId":"event-alex","recipientUserId":"u-alex",' +
                '"occurrences":[{"start":6,"length":12}]}]}'
        );
        for (const leaked of [
            "Robert",
            "DROP TABLE",
            "private.address@example.invalid",
            "Confidential",
            "recipientName",
            "recipientEmail",
            "jobTitle",
        ]) {
            expect(written).not.toContain(leaked);
        }
    });

    it("declares schema version 1", () => {
        expect(MENTION_METADATA_SCHEMA_VERSION).toBe(1);
        expect(serializeMentionMetadata("description", [])).toContain('"schemaVersion":1');
    });

    it("writes a session that means to notify nobody as an empty list", () => {
        expect(serializeMentionMetadata("description", [])).toBe(
            '{"schemaVersion":1,"sourceField":"description","mentions":[]}'
        );
    });

    it("carries the column the mentions were written in", () => {
        expect(serializeMentionMetadata("ayonto_notes", [])).toContain('"sourceField":"ayonto_notes"');
    });

    it("orders the same people the same way, whatever order they arrive in", () => {
        expect(serializeMentionMetadata("description", [alex, dana])).toBe(
            serializeMentionMetadata("description", [dana, alex])
        );
    });

    it("orders by recipient, not by where the mention stands in the text", () => {
        const written = JSON.parse(serializeMentionMetadata("description", [dana, alex])) as {
            mentions: { recipientUserId: string }[];
        };

        expect(written.mentions.map((mention) => mention.recipientUserId)).toEqual([
            "u-alex",
            "u-dana",
        ]);
    });

    it("writes no whitespace a reader would have to step over", () => {
        const written = serializeMentionMetadata("description", [alex, dana]);

        expect(written).not.toMatch(/\n|\s{2}/);
        expect(written.startsWith("{")).toBe(true);
    });

    it("writes the same string for the same events every time", () => {
        expect(serializeMentionMetadata("description", [alex, dana])).toBe(
            serializeMentionMetadata("description", [alex, dana])
        );
    });
});

describe("createEventId", () => {
    it("produces a fresh identifier every time", () => {
        const ids = new Set(Array.from({ length: 64 }, () => createEventId()));

        expect(ids.size).toBe(64);
    });

    it("produces a version 4 UUID", () => {
        expect(createEventId()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
    });
});
