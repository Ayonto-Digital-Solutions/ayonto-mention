/**
 * Pure helpers for turning raw text plus a caret position into an "@" mention
 * trigger, and for writing a picked mention back into the text.
 *
 * Everything here is free of DOM, React and platform dependencies, so it can be
 * reasoned about and unit tested on its own. Dataverse access, escaping and URL
 * building deliberately live in later integration layers, not here.
 */

/** Characters that may precede an "@" for it to start a mention. */
const MENTION_BOUNDARY = /[\s([{>]/;

/**
 * Characters that end a mention. Anything else — a letter, a digit, a hyphen —
 * continues the name, so "@Dana Winter" is not a mention of "Dana".
 */
const MENTION_END = /[\s,.;:!?()[\]{}"]/;

/**
 * True when an "@" at this index could have opened a mention.
 *
 * The one rule: it stands at the beginning of the text, or behind whitespace or
 * an opening bracket. That is what keeps the "@" of an e-mail address from
 * reading as a mention of the domain behind it.
 */
function opensMention(text: string, at: number): boolean {
    if (text[at] !== "@") {
        return false;
    }
    const previous = at > 0 ? text[at - 1] : undefined;
    return previous === undefined || MENTION_BOUNDARY.test(previous);
}

/** True when a mention may end just before this index — a boundary, or the end. */
function endsMention(text: string, at: number): boolean {
    const following = text[at];
    return following === undefined || MENTION_END.test(following);
}

/**
 * True when this stretch of text reads as a whole mention, from its "@" to its
 * last character.
 *
 * For spans that come from *outside* this editor — a stored payload naming a
 * position in text somebody else may have edited since. A position on its own
 * proves nothing, so it is held to exactly what the editor itself would have
 * produced: an "@" that could have opened a mention, at least one character of a
 * name, an end where a mention may end, and no line break in between, because a
 * mention is never written across one.
 *
 * `"@Alex Rivera"` in `"@Alex RiveraX"` fails here, and is meant to: drawing the
 * first twelve characters as a person would show a name the text does not have.
 */
export function readsAsMentionSpan(text: string, span: TextSpan): boolean {
    if (span.end <= span.start + 1 || span.end > text.length) {
        return false;
    }
    if (!opensMention(text, span.start) || !endsMention(text, span.end)) {
        return false;
    }

    return !/[\r\n]/.test(text.slice(span.start, span.end));
}

/** A mention query never spans more characters than this. */
export const MAX_QUERY_LENGTH = 40;

export interface MentionTrigger {
    /** Index of the "@" that opened the mention. */
    readonly start: number;
    /** Index just past the last character belonging to the query. */
    readonly end: number;
    /** The text typed after the "@", without the "@" itself. */
    readonly query: string;
}

/**
 * Finds the mention the caret currently sits in, or null when the caret is not
 * inside one.
 *
 * A mention starts at an "@" that is either at the beginning of the text or
 * preceded by whitespace or an opening bracket — which is what keeps an e-mail
 * address from triggering one. User names contain a space, so the query may hold
 * one too, but not more and not a trailing one. Without that bound the query
 * would keep swallowing the rest of the sentence and every further keystroke
 * would trigger another lookup. The query also never crosses a line break and
 * never grows past MAX_QUERY_LENGTH.
 */
export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
    if (caret < 0 || caret > text.length) {
        return null;
    }

    const lowerBound = Math.max(0, caret - (MAX_QUERY_LENGTH + 1));
    for (let i = caret - 1; i >= lowerBound; i--) {
        const character = text[i];

        if (character === "\n" || character === "\r") {
            return null;
        }

        if (character === "@") {
            if (!opensMention(text, i)) {
                return null;
            }

            const query = text.slice(i + 1, caret);
            if (query.endsWith(" ") || query.split(" ").length > 2) {
                return null;
            }

            return { start: i, end: caret, query };
        }
    }

    return null;
}

export interface MentionInsertResult {
    readonly text: string;
    readonly caret: number;
}

/**
 * Replaces the triggering "@query" with "@Display Name " and reports where the
 * caret has to be placed afterwards.
 *
 * The caret always ends up behind the single space that follows the name —
 * behind the one this writes, or behind the one that was already there. Leaving
 * it in front of an existing space would put the next keystroke inside the name
 * and break the mention.
 */
export function applyMention(
    text: string,
    trigger: MentionTrigger,
    displayName: string
): MentionInsertResult {
    const mention = `@${displayName.trim()}`;
    const tail = text.slice(trigger.end);
    const reusesExistingSpace = tail.startsWith(" ");
    const head = `${text.slice(0, trigger.start)}${mention}${reusesExistingSpace ? "" : " "}`;

    return {
        text: `${head}${tail}`,
        caret: head.length + (reusesExistingSpace ? 1 : 0),
    };
}

/**
 * A mention this editor wrote: where it sits, whose name it carries, and — the
 * part the text cannot express — which person it means. Two people can share a
 * display name, so the name is never the identity.
 */
export interface InsertedMention {
    readonly start: number;
    readonly name: string;
    readonly userId: string;
}

/** A stretch of text, from `start` up to but not including `end`. */
export interface TextSpan {
    readonly start: number;
    readonly end: number;
}

/** Where a mention stands in the text: the "@" and the name that follows it. */
export function mentionSpan(mention: InsertedMention): TextSpan {
    return { start: mention.start, end: mention.start + mention.name.length + 1 };
}

/**
 * What a Backspace or a Delete should take when the caret is at a mention: the
 * whole name, instead of the one character next to the caret. Returns null
 * everywhere else, and the key then keeps its ordinary meaning.
 *
 * A mention is one thing to whoever reads it. "@Alex Rivera" names a person,
 * "@Alex Rive" names nobody — so taking one letter out of it does not leave half
 * a mention, it leaves text that still looks like one while the person it stood
 * for has already dropped out. Whoever starts deleting a name means the name.
 *
 * Only mentions this editor is tracking count. A name somebody typed by hand is
 * ordinary text and deletes one character at a time, because nothing ever said
 * it was meant as a mention.
 *
 * The two directions are the halves a text field works on: `backward` is
 * Backspace and reaches the mention ending at the caret, `forward` is Delete and
 * reaches the one starting there. A caret inside a mention is reached by both.
 */
export function mentionDeletionRange(
    text: string,
    caret: number,
    direction: "backward" | "forward",
    mentions: readonly InsertedMention[]
): TextSpan | null {
    const span = mentions
        .map(mentionSpan)
        .find((candidate) =>
            direction === "backward"
                ? caret > candidate.start && caret <= candidate.end
                : caret >= candidate.start && caret < candidate.end
        );
    if (span === undefined) {
        return null;
    }

    // A mention standing in a sentence has a space on either side of it. Leaving
    // both behind would put a double space where the name was, so the one behind
    // the mention goes with it.
    const takesFollowingSpace =
        span.start > 0 && text[span.start - 1] === " " && text[span.end] === " ";

    return { start: span.start, end: takesFollowingSpace ? span.end + 1 : span.end };
}

/** True when "@name" stands at exactly this position and ends where a mention may end. */
function readsAsMention(text: string, at: number, name: string): boolean {
    return text.startsWith(`@${name}`, at) && endsMention(text, at + name.length + 1);
}

/**
 * The single stretch two texts disagree about: everything before `from` and
 * everything from `to` on came through the edit untouched, and what sat behind
 * `to` moved by `delta`.
 *
 * One contiguous stretch is what a textarea produces — typing, pasting, deleting
 * a selection. A value the platform pushes in wholesale is not, and then the
 * stretch simply covers everything that changed, which drops every mention
 * inside it. That is the safe direction.
 */
function editedSpan(
    previous: string,
    text: string
): { from: number; to: number; delta: number } {
    const shortest = Math.min(previous.length, text.length);
    let from = 0;
    while (from < shortest && previous[from] === text[from]) {
        from += 1;
    }
    let tail = 0;
    while (
        tail < shortest - from &&
        previous[previous.length - 1 - tail] === text[text.length - 1 - tail]
    ) {
        tail += 1;
    }

    return {
        from,
        to: previous.length - tail,
        delta: text.length - previous.length,
    };
}

/**
 * Moves the mentions the editor wrote to where they now sit, and forgets the
 * ones the edit took.
 *
 * Their positions are what tells a sentence carrying on after a mention
 * ("@Dana thanks") from a new query that happens to start with the same name
 * ("@Dana Winter") — the two read alike, only their origin differs. Every edit
 * before a mention moves it, so a position left where it was points at the wrong
 * place, and the rule that reads it quietly stops working.
 *
 * An edit leaves each mention exactly two possible places: where it was, and
 * that shifted by what the edit added or removed. Both are read off the change
 * itself, which is the whole point — the text afterwards cannot say which of two
 * people with the same name was the one deleted. Looking the name up again
 * answered that wrongly: deleting the first of two identical names left the
 * deleted person's record sitting on the surviving mention, so the person just
 * taken out was notified and the one still standing in the text was not.
 *
 * Two identical mentions written directly next to each other are the one case
 * nothing can settle: deleting either leaves the same text behind. Then the
 * later one counts as the deleted one.
 */
export function reanchorMentions<T extends InsertedMention>(
    mentions: readonly T[],
    previous: string,
    text: string
): T[] {
    const { from, to, delta } = editedSpan(previous, text);
    const anchored: T[] = [];
    // One mention in the text speaks for one record. Two records reaching for the
    // same place would otherwise both keep it, and one of them means somebody the
    // text no longer names.
    const taken = new Set<number>();

    for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
        // What lies in front of the edit stayed put, what lies behind it moved by
        // what the edit added or removed. Where the edit runs through a mention,
        // neither is certain — an insertion that begins with the same character it
        // is placed in front of reads as both — so both places are offered and the
        // text decides which one still holds the mention.
        const places: number[] = [];
        if (mention.start < to) {
            places.push(mention.start);
        }
        if (mention.start + mention.name.length + 1 > from) {
            places.push(mention.start + delta);
        }

        const at = places.find(
            (place) => place >= 0 && !taken.has(place) && readsAsMention(text, place, mention.name)
        );
        if (at === undefined) {
            continue;
        }
        taken.add(at);
        // Spread, not a rebuild: whatever a caller tracks alongside a mention
        // travels with it, and only the position changes.
        anchored.push({ ...mention, start: at });
    }

    return anchored;
}

/** A run of the text, and the mention it is when it is one. */
export interface TrackedSegment<T extends InsertedMention> {
    readonly text: string;
    /** Present only for a run this editor is tracking as a mention. */
    readonly mention?: T | undefined;
}

/**
 * Cuts the text into the runs a reader sees: ordinary text, and the mentions
 * this editor is tracking.
 *
 * Only tracked mentions become mentions. A name somebody typed by hand reads
 * exactly like one and is not one, so it stays in the plain run around it — the
 * text cannot say who it meant, and neither can this.
 *
 * Every character of the text appears in exactly one run, in order, so the runs
 * concatenate back to what was passed in. Whitespace and line breaks are part of
 * the plain runs and are never trimmed away.
 */
export function splitTrackedMentions<T extends InsertedMention>(
    text: string,
    mentions: readonly T[]
): TrackedSegment<T>[] {
    const segments: TrackedSegment<T>[] = [];
    let plainFrom = 0;

    for (const mention of [...mentions].sort((left, right) => left.start - right.start)) {
        const { start, end } = mentionSpan(mention);
        // A mention that no longer lines up with the text is not drawn over it.
        if (start < plainFrom || end > text.length) {
            continue;
        }

        if (start > plainFrom) {
            segments.push({ text: text.slice(plainFrom, start) });
        }
        segments.push({ text: text.slice(start, end), mention });
        plainFrom = end;
    }

    if (plainFrom < text.length) {
        segments.push({ text: text.slice(plainFrom) });
    }

    return segments;
}

/** A run of text, and the user it mentions when it is one. */
export interface MentionSegment {
    readonly text: string;
    /**
     * Explicitly `string | undefined` rather than a plain optional: a mention
     * whose name the caller could not resolve still becomes its own segment, and
     * `exactOptionalPropertyTypes` would otherwise reject writing `undefined`.
     */
    readonly userId?: string | undefined;
}

/**
 * Splits the text into plain runs and the mentions among them, so the editor can
 * show a written mention as a link to the person it names.
 *
 * Only names the caller could resolve become mentions — the text alone cannot
 * say whether "@Alex Rivera" is a person or a sentence, and a link that opens the
 * wrong record is worse than no link. Longer names win, so "@Dana Winter" is not
 * read as a mention of "Dana".
 */
export function splitMentions(
    text: string,
    users: ReadonlyMap<string, string>,
    written: readonly InsertedMention[] = []
): MentionSegment[] {
    if ((users.size === 0 && written.length === 0) || text.length === 0) {
        return text.length > 0 ? [{ text }] : [];
    }

    const names = [
        ...new Set([...users.keys(), ...written.map((mention) => mention.name)]),
    ].sort((left, right) => right.length - left.length);
    const segments: MentionSegment[] = [];
    let plainFrom = 0;

    for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
        if (!opensMention(text, at)) {
            continue;
        }

        const name = names.find((candidate) => readsAsMention(text, at, candidate));
        if (name === undefined) {
            continue;
        }

        if (at > plainFrom) {
            segments.push({ text: text.slice(plainFrom, at) });
        }
        // A mention written here beats the name: it knows which of two namesakes
        // was picked.
        const here = written.find((mention) => mention.start === at && mention.name === name);
        segments.push({
            text: `@${name}`,
            userId: here?.userId ?? users.get(name),
        });
        plainFrom = at + name.length + 1;
        at = plainFrom - 1;
    }

    if (plainFrom < text.length) {
        segments.push({ text: text.slice(plainFrom) });
    }

    return segments;
}
