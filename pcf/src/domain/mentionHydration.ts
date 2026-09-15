/**
 * Reading a stored companion payload back into the mentions an editor tracks.
 *
 * Everything here treats the payload as something a stranger wrote, because that
 * is what it is: the column sits on a business record and anyone who may write
 * the text may write this too. So nothing is inferred and nothing is repaired.
 * A payload is either exactly what this control writes — right version, right
 * column, well-formed identifiers, spans that still line up with the text in
 * front of us — or the mentions it claims are not mentions at all and the text
 * stays ordinary text.
 *
 * What is *not* done here matters as much. A display name is never matched
 * against anything: "@Robin Fox" in the text is not evidence that any particular
 * Robin Fox was meant. The name shown for a hydrated mention is read out of the
 * saved text at the position the payload names, which is why the name never has
 * to be stored.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 */

import type { MentionOccurrence } from "./mentionLifecycle";
import { readsAsMentionSpan } from "./mentionText";
import { MENTION_METADATA_SCHEMA_VERSION } from "./mentionMetadata";
import { isDataverseId, normalizeDataverseId } from "./recordContext";

/** What a stored payload turned out to be worth. */
export interface HydratedMentions {
    /** The mentions the editor may start with, in text order. */
    readonly mentions: readonly MentionOccurrence[];
    /** The episode each recipient is already in, by normalized user id. */
    readonly episodes: ReadonlyMap<string, string>;
}

const NOTHING: HydratedMentions = { mentions: [], episodes: new Map<string, string>() };

/** Canonical lower-case UUID, the only shape this control ever writes. */
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A parsed value, only where it really is what it claims to be. */
function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** A whole number, and nothing that merely looks like one. */
function asInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Reads one span, and only when the text in front of us still agrees with it.
 *
 * The span has to sit inside the text and cover exactly what the editor itself
 * would have written there: an "@" that could have opened a mention, a name
 * after it, and an end where a mention may end. That last part is the whole
 * point of asking `readsAsMentionSpan` rather than checking the "@" here — a
 * stored span for "@Alex Rivera" must not quietly draw the first twelve
 * characters of "@Alex RiveraX" as a person.
 *
 * A payload that survived an edit it did not see — text deleted, the record
 * saved by something else — fails here, and the name it pointed at goes back to
 * being ordinary text rather than becoming a mention of whoever used to be
 * there.
 */
function readOccurrence(value: unknown, text: string): { start: number; length: number } | null {
    const span = asRecord(value);
    if (span === null) {
        return null;
    }

    const start = asInteger(span.start);
    const length = asInteger(span.length);
    if (start === null || length === null) {
        return null;
    }
    if (start < 0 || !readsAsMentionSpan(text, { start, end: start + length })) {
        return null;
    }

    return { start, length };
}

/**
 * Turns a stored payload into the mentions an editor can start with.
 *
 * Anything unexpected ends the whole payload rather than part of it: a payload
 * this control did not write is not a payload to take pieces out of. The one
 * exception is a single occurrence that no longer lines up with the text — the
 * record may legitimately have been edited elsewhere — which drops that
 * occurrence and keeps the rest.
 *
 * @param raw What the companion column holds.
 * @param sourceField The logical name of the column actually bound right now.
 * @param text The saved text the spans are supposed to describe.
 */
export function hydratePersistedMentions(
    raw: string,
    sourceField: string,
    text: string
): HydratedMentions {
    if (raw.trim().length === 0) {
        return NOTHING;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Not our payload, and nothing to repair.
        return NOTHING;
    }

    const envelope = asRecord(parsed);
    if (envelope?.schemaVersion !== MENTION_METADATA_SCHEMA_VERSION) {
        return NOTHING;
    }
    // The payload belongs to one column. Taken on another, it describes
    // positions in text it has never seen.
    if (asString(envelope.sourceField) !== sourceField) {
        return NOTHING;
    }

    const events = envelope.mentions;
    if (!Array.isArray(events)) {
        return NOTHING;
    }

    const mentions: MentionOccurrence[] = [];
    const episodes = new Map<string, string>();
    // One position speaks for one person. Two events reaching for the same place
    // cannot both be right, and there is no way to tell which is.
    const taken: { start: number; end: number }[] = [];

    for (const value of events) {
        const event = asRecord(value);
        if (event === null) {
            return NOTHING;
        }

        const eventId = asString(event.eventId).toLowerCase();
        const recipientUserId = normalizeDataverseId(asString(event.recipientUserId));
        // An id out of an untrusted payload ends up in a Web API call and, if it
        // were believed, in a navigation. Neither is ever handed a non-id.
        if (!EVENT_ID.test(eventId) || !isDataverseId(recipientUserId)) {
            return NOTHING;
        }
        // The same person twice is two claims on one episode.
        if (episodes.has(recipientUserId)) {
            return NOTHING;
        }

        const occurrences = event.occurrences;
        if (!Array.isArray(occurrences)) {
            return NOTHING;
        }

        let hydratedAny = false;
        for (const candidate of occurrences) {
            const span = readOccurrence(candidate, text);
            if (span === null) {
                // The text moved on without this one. It stays ordinary text.
                continue;
            }

            const end = span.start + span.length;
            if (taken.some((other) => other.start < end && span.start < other.end)) {
                return NOTHING;
            }
            taken.push({ start: span.start, end });

            mentions.push({
                start: span.start,
                // Read from the text, never from the payload: the name is what
                // the record says it is.
                name: text.slice(span.start + 1, end),
                userId: recipientUserId,
            });
            hydratedAny = true;
        }

        // An episode with nothing left to point at is over. Seeding it would
        // keep an identifier alive for a mention the text no longer carries.
        if (hydratedAny) {
            episodes.set(recipientUserId, eventId);
        }
    }

    return {
        mentions: mentions.sort((left, right) => left.start - right.start),
        episodes,
    };
}
