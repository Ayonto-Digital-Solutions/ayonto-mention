import {
    MENTION_METADATA_SCHEMA_VERSION,
    serializeMentionMetadata,
} from "../src/domain/mentionMetadata";
import type { MentionNotificationEvent } from "../src/domain/mentionMetadata";
import { createEventId } from "../src/services/eventId";

const alex: MentionNotificationEvent = {
    eventId: "event-alex",
    recipientUserId: "u-alex",
    recipientName: "Alex Rivera",
    recipientEmail: "alex.rivera@example.invalid",
};
const dana: MentionNotificationEvent = {
    eventId: "event-dana",
    recipientUserId: "u-dana",
    recipientName: "Dana Winter",
};

describe("serializeMentionMetadata", () => {
    it("writes the envelope the server reads", () => {
        expect(JSON.parse(serializeMentionMetadata("description", [alex]))).toEqual({
            schemaVersion: 1,
            sourceField: "description",
            mentions: [
                {
                    eventId: "event-alex",
                    recipientUserId: "u-alex",
                    recipientName: "Alex Rivera",
                    recipientEmail: "alex.rivera@example.invalid",
                },
            ],
        });
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

    it("leaves the address out rather than writing an empty one", () => {
        const written = serializeMentionMetadata("description", [dana]);

        expect(written).not.toContain("recipientEmail");
        expect(JSON.parse(written)).toEqual({
            schemaVersion: 1,
            sourceField: "description",
            mentions: [
                { eventId: "event-dana", recipientUserId: "u-dana", recipientName: "Dana Winter" },
            ],
        });
    });

    it("treats an address of nothing but spaces as no address", () => {
        expect(
            serializeMentionMetadata("description", [{ ...dana, recipientEmail: "   " }])
        ).not.toContain("recipientEmail");
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
