import {
    hydrateOccurrences,
    resolvePersistedIdentities,
} from "../src/domain/mentionHydration";
import type { PersistedIdentity } from "../src/domain/mentionHydration";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import type { MentionRecipient } from "../src/domain/mentionPersistence";

/** Fictional people. Two of them deliberately share a display name. */
const ALEX = "Alex Rivera";
const DANA = "Dana Winter";
const ROBIN = "Robin Fox";

function recipient(
    name: string,
    userId: string,
    email?: string
): MentionRecipient {
    return email === undefined ? { userId, name } : { userId, name, email };
}

function identities(
    ...recipients: readonly MentionRecipient[]
): ReadonlyMap<string, PersistedIdentity> {
    return resolvePersistedIdentities(recipients);
}

describe("resolvePersistedIdentities", () => {
    it("resolves a display name that was only ever one person", () => {
        expect([...identities(recipient(ALEX, "u-alex"))]).toEqual([
            [ALEX, { userId: "u-alex" }],
        ]);
    });

    it("keeps the address when the row carries one", () => {
        expect(identities(recipient(ALEX, "u-alex", "alex.rivera@example.invalid")).get(ALEX)).toEqual({
            userId: "u-alex",
            email: "alex.rivera@example.invalid",
        });
    });

    it("is not confused by several rows for the same person", () => {
        // One person mentioned three times is three rows, not three people.
        const resolved = identities(
            recipient(ALEX, "u-alex"),
            recipient(ALEX, "u-alex"),
            recipient(ALEX, "u-alex")
        );

        expect(resolved.get(ALEX)).toEqual({ userId: "u-alex" });
    });

    it("treats braced and upper-case ids as the same person", () => {
        const resolved = identities(
            recipient(ROBIN, "{AAAAAAAA-1111-2222-3333-444444444444}"),
            recipient(ROBIN, "aaaaaaaa-1111-2222-3333-444444444444")
        );

        expect(resolved.get(ROBIN)).toEqual({
            userId: "aaaaaaaa-1111-2222-3333-444444444444",
        });
    });

    it("refuses a display name two different people were stored under", () => {
        // "@Robin Fox" reads the same either way, and picking the row that came
        // back first would notify the wrong person on every later visit.
        expect(identities(recipient(ROBIN, "id-a"), recipient(ROBIN, "id-b")).has(ROBIN)).toBe(
            false
        );
    });

    it("keeps other names resolvable when one of them is ambiguous", () => {
        const resolved = identities(
            recipient(ROBIN, "id-a"),
            recipient(ROBIN, "id-b"),
            recipient(ALEX, "u-alex")
        );

        expect(resolved.has(ROBIN)).toBe(false);
        expect(resolved.get(ALEX)).toEqual({ userId: "u-alex" });
    });

    it("drops the address when the rows for one person disagree about it", () => {
        // The identity is not in doubt, only the address is.
        const resolved = identities(
            recipient(ALEX, "u-alex", "alex.rivera@example.invalid"),
            recipient(ALEX, "u-alex", "a.rivera@example.invalid")
        );

        expect(resolved.get(ALEX)).toEqual({ userId: "u-alex" });
    });

    it("keeps the address the rows agree on", () => {
        const resolved = identities(
            recipient(ALEX, "u-alex", "alex.rivera@example.invalid"),
            recipient(ALEX, "u-alex", "alex.rivera@example.invalid")
        );

        expect(resolved.get(ALEX)).toEqual({
            userId: "u-alex",
            email: "alex.rivera@example.invalid",
        });
    });

    it("takes the address from the rows that have one", () => {
        const resolved = identities(
            recipient(ALEX, "u-alex"),
            recipient(ALEX, "u-alex", "alex.rivera@example.invalid")
        );

        expect(resolved.get(ALEX)).toEqual({
            userId: "u-alex",
            email: "alex.rivera@example.invalid",
        });
    });

    it("ignores rows that name nobody identifiable", () => {
        expect([...identities(recipient(ALEX, "   "), recipient("  ", "u-x"))]).toEqual([]);
    });

    it("matches the stored name as it was trimmed", () => {
        expect(identities(recipient(`  ${ALEX}  `, "u-alex")).get(ALEX)).toEqual({
            userId: "u-alex",
        });
    });
});

describe("hydrateOccurrences", () => {
    it("gives a mention standing in the text the person it was written for", () => {
        expect(hydrateOccurrences(`Hi @${ALEX}, thanks`, identities(recipient(ALEX, "u-alex")), [])).toEqual([
            { start: 3, name: ALEX, userId: "u-alex" },
        ]);
    });

    it("carries the address along when it is beyond doubt", () => {
        const resolved = identities(recipient(ALEX, "u-alex", "alex.rivera@example.invalid"));

        expect(hydrateOccurrences(`@${ALEX} `, resolved, [])).toEqual([
            {
                start: 0,
                name: ALEX,
                userId: "u-alex",
                email: "alex.rivera@example.invalid",
            },
        ]);
    });

    it("infers nothing for a name two people were stored under", () => {
        const resolved = identities(recipient(ROBIN, "id-a"), recipient(ROBIN, "id-b"));

        expect(hydrateOccurrences(`Hello @${ROBIN}`, resolved, [])).toEqual([]);
    });

    it("hydrates every place one person is named, and keeps them apart", () => {
        const resolved = identities(recipient(DANA, "u-dana"));

        expect(hydrateOccurrences(`@${DANA} and @${DANA} again`, resolved, [])).toEqual([
            { start: 0, name: DANA, userId: "u-dana" },
            { start: 17, name: DANA, userId: "u-dana" },
        ]);
    });

    it("leaves an occurrence this session already knows exactly as it is", () => {
        // The user picked the other namesake while the read was still out. What
        // they picked is what the mention means.
        const tracked: MentionOccurrence = { start: 0, name: ROBIN, userId: "id-b" };
        const resolved = identities(recipient(ROBIN, "id-a"));

        expect(hydrateOccurrences(`@${ROBIN} `, resolved, [tracked])).toEqual([tracked]);
    });

    it("does not overwrite the address a picked suggestion carried", () => {
        const tracked: MentionOccurrence = {
            start: 0,
            name: ALEX,
            userId: "u-alex",
            email: "picked@example.invalid",
        };
        const resolved = identities(recipient(ALEX, "u-alex", "stored@example.invalid"));

        expect(hydrateOccurrences(`@${ALEX} `, resolved, [tracked])).toEqual([tracked]);
    });

    it("fills the untracked occurrences and leaves the tracked one alone", () => {
        const tracked: MentionOccurrence = { start: 0, name: DANA, userId: "u-other" };
        const resolved = identities(recipient(DANA, "u-dana"));

        expect(hydrateOccurrences(`@${DANA} and @${DANA} `, resolved, [tracked])).toEqual([
            tracked,
            { start: 17, name: DANA, userId: "u-dana" },
        ]);
    });

    it("reports the merged set in text order", () => {
        const tracked: MentionOccurrence = { start: 16, name: DANA, userId: "u-dana" };
        const resolved = identities(recipient(ALEX, "u-alex"));

        expect(
            hydrateOccurrences(`Hi @${ALEX}, @${DANA} `, resolved, [tracked]).map(
                (occurrence) => occurrence.start
            )
        ).toEqual([3, 16]);
    });

    it("does not read an e-mail address as a mention", () => {
        const resolved = identities(recipient("Dana", "u-dana"));

        expect(hydrateOccurrences("write to dana@Dana now", resolved, [])).toEqual([]);
    });

    it("does not hydrate a name the text only starts with", () => {
        const resolved = identities(recipient(DANA, "u-dana"));

        expect(hydrateOccurrences(`@${DANA}son `, resolved, [])).toEqual([]);
    });

    it("prefers the longer stored name over the shorter namesake", () => {
        // "@Dana Winter" also reads as a mention of "Dana" followed by a space.
        const resolved = identities(recipient("Dana", "u-short"), recipient(DANA, "u-dana"));

        expect(hydrateOccurrences(`@${DANA} `, resolved, [])).toEqual([
            { start: 0, name: DANA, userId: "u-dana" },
        ]);
    });

    it("keeps a short name picked by hand when a longer stored one covers it", () => {
        // The user picked "@Dana" and typed the rest of the sentence themselves.
        const tracked: MentionOccurrence = { start: 0, name: "Dana", userId: "u-short" };
        const resolved = identities(recipient(DANA, "u-dana"));

        expect(hydrateOccurrences(`@${DANA} `, resolved, [tracked])).toEqual([tracked]);
    });

    it("hydrates nothing when the store knew nobody", () => {
        expect(hydrateOccurrences(`@${ALEX} `, identities(), [])).toEqual([]);
    });

    it("keeps what is tracked even when the store knew nobody", () => {
        const tracked: MentionOccurrence = { start: 0, name: ALEX, userId: "u-alex" };

        expect(hydrateOccurrences(`@${ALEX} `, identities(), [tracked])).toEqual([tracked]);
    });

    it("does not invent a mention for a stored name the text does not carry", () => {
        expect(hydrateOccurrences("no mentions here", identities(recipient(ALEX, "u-alex")), [])).toEqual(
            []
        );
    });
});
