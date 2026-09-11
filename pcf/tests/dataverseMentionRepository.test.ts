import { DataverseMentionRepository } from "../src/services/dataverseMentionRepository";
import { MentionRepositoryError } from "../src/domain/mentionPersistence";
import type { CreateMentionRequest, PersistedMention } from "../src/domain/mentionPersistence";
import type { MentionRecordContext } from "../src/domain/recordContext";

/** A normalized context, as resolveRecordContext would produce it. */
const context: MentionRecordContext = {
    recordId: "11111111-2222-3333-4444-555555555555",
    recordTable: "account",
    sourceField: "description",
};

interface RecordedCreate {
    readonly entity: string;
    readonly data: Record<string, unknown>;
}

interface RecordedQuery {
    readonly entity: string;
    readonly options: string;
}

interface Harness {
    readonly webAPI: ComponentFramework.WebApi;
    readonly creates: readonly RecordedCreate[];
    readonly queries: readonly RecordedQuery[];
}

/** A Web API that answers each retrieve with the next scripted page. */
function makeWebApi(
    pages: readonly { entities: Record<string, unknown>[]; nextLink?: string }[] = [
        { entities: [] },
    ],
    createdId = "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB"
): Harness {
    const creates: RecordedCreate[] = [];
    const queries: RecordedQuery[] = [];
    let page = 0;

    return {
        creates,
        queries,
        webAPI: {
            createRecord: jest.fn((entity: string, data: Record<string, unknown>) => {
                creates.push({ entity, data });
                return Promise.resolve({ id: createdId, entityType: entity });
            }),
            retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
                queries.push({ entity, options: options ?? "" });
                const current = pages[Math.min(page, pages.length - 1)];
                page += 1;
                return Promise.resolve({
                    entities: current?.entities ?? [],
                    nextLink: current?.nextLink ?? "",
                });
            }),
        } as unknown as ComponentFramework.WebApi,
    };
}

function request(over: Partial<CreateMentionRequest["recipient"]> = {}): CreateMentionRequest {
    return {
        context,
        recipient: {
            userId: "99999999-8888-7777-6666-555555555555",
            name: "Alex Rivera",
            email: "alex.rivera@example.invalid",
            ...over,
        },
    };
}

/** A stored row, with every value fictional. */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    ayonto_mentionid: "0a0a0a0a-1111-2222-3333-444444444444",
    ayonto_recipientuserid: "99999999-8888-7777-6666-555555555555",
    ayonto_recipientname: "Alex Rivera",
    ayonto_recipientemail: "alex.rivera@example.invalid",
    ...over,
});

const firstQuery = (harness: Harness): RecordedQuery => {
    const query = harness.queries[0];
    if (query === undefined) {
        throw new Error("expected at least one query");
    }
    return query;
};

const firstCreate = (harness: Harness): RecordedCreate => {
    const create = harness.creates[0];
    if (create === undefined) {
        throw new Error("expected at least one create");
    }
    return create;
};

const ids = (mentions: readonly PersistedMention[]): readonly string[] =>
    mentions.map((mention) => mention.recipient.userId);

describe("DataverseMentionRepository.create", () => {
    it("writes to the mention table", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(request());

        expect(firstCreate(harness).entity).toBe("ayonto_mention");
    });

    it("writes exactly the identity and context of the mention", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(request());

        expect(firstCreate(harness).data).toEqual({
            ayonto_name: "@Alex Rivera",
            ayonto_recipientuserid: "99999999-8888-7777-6666-555555555555",
            ayonto_recipientname: "Alex Rivera",
            ayonto_recipientemail: "alex.rivera@example.invalid",
            ayonto_recordtable: "account",
            ayonto_recordid: "11111111-2222-3333-4444-555555555555",
            ayonto_sourcefield: "description",
        });
    });

    it("records which field the mention was written in", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(request());

        expect(firstCreate(harness).data.ayonto_sourcefield).toBe("description");
    });

    it("writes no delivery state of its own", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(request());

        // The table's own default owns that, and its Choice values do not exist yet.
        const written = Object.keys(firstCreate(harness).data);
        expect(written).not.toContain("statuscode");
        expect(written).not.toContain("statecode");
        expect(written).toHaveLength(7);
    });

    it("leaves the email out when there is none", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(request({ email: "   " }));

        expect(firstCreate(harness).data).not.toHaveProperty("ayonto_recipientemail");
    });

    it("trims the recipient values it writes", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(
            request({ name: "  Alex Rivera  ", email: "  alex.rivera@example.invalid  " })
        );

        expect(firstCreate(harness).data.ayonto_name).toBe("@Alex Rivera");
        expect(firstCreate(harness).data.ayonto_recipientname).toBe("Alex Rivera");
        expect(firstCreate(harness).data.ayonto_recipientemail).toBe(
            "alex.rivera@example.invalid"
        );
    });

    it("leaves the email out when the recipient has none at all", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create({
            context,
            recipient: { userId: "99999999-8888-7777-6666-555555555555", name: "Alex Rivera" },
        });

        expect(firstCreate(harness).data).not.toHaveProperty("ayonto_recipientemail");
        expect(firstCreate(harness).data).toEqual({
            ayonto_name: "@Alex Rivera",
            ayonto_recipientuserid: "99999999-8888-7777-6666-555555555555",
            ayonto_recipientname: "Alex Rivera",
            ayonto_recordtable: "account",
            ayonto_recordid: "11111111-2222-3333-4444-555555555555",
            ayonto_sourcefield: "description",
        });
    });

    it("normalizes the braces and case of the recipient id", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).create(
            request({ userId: "  {99999999-8888-7777-6666-555555555555}  " })
        );

        expect(firstCreate(harness).data.ayonto_recipientuserid).toBe(
            "99999999-8888-7777-6666-555555555555"
        );
    });

    it("normalizes the id the platform hands back", async () => {
        const harness = makeWebApi([{ entities: [] }], "{AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB}");

        const created = await new DataverseMentionRepository(harness.webAPI).create(request());

        expect(created.id).toBe("aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
    });

    it("returns the recipient it stored", async () => {
        const harness = makeWebApi();

        const created = await new DataverseMentionRepository(harness.webAPI).create(request());

        expect(created.recipient).toEqual({
            userId: "99999999-8888-7777-6666-555555555555",
            name: "Alex Rivera",
            email: "alex.rivera@example.invalid",
        });
    });

    it("refuses a recipient without an id, without calling the Web API", async () => {
        const harness = makeWebApi();

        await expect(
            new DataverseMentionRepository(harness.webAPI).create(request({ userId: "  " }))
        ).rejects.toBeInstanceOf(MentionRepositoryError);
        expect(harness.creates).toEqual([]);
    });

    it("refuses a recipient without a name, without calling the Web API", async () => {
        const harness = makeWebApi();

        await expect(
            new DataverseMentionRepository(harness.webAPI).create(request({ name: "   " }))
        ).rejects.toBeInstanceOf(MentionRepositoryError);
        expect(harness.creates).toEqual([]);
    });

    it("turns a write failure into a neutral error", async () => {
        const detail = "Access denied at org-a1b2c3.example.invalid";
        const webAPI = {
            createRecord: jest.fn(() => Promise.reject(new Error(detail))),
        } as unknown as ComponentFramework.WebApi;

        const failure = await new DataverseMentionRepository(webAPI)
            .create(request())
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(MentionRepositoryError);
        expect((failure as MentionRepositoryError).operation).toBe("write");
        expect((failure as Error).message).not.toContain(detail);
        expect((failure as Error).message).not.toContain("example.invalid");
    });
});

describe("DataverseMentionRepository.list", () => {
    it("reads from the mention table", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(firstQuery(harness).entity).toBe("ayonto_mention");
    });

    it("scopes the query to the record's table", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(firstQuery(harness).options).toContain("ayonto_recordtable eq 'account'");
    });

    it("scopes the query to the record", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(firstQuery(harness).options).toContain(
            "ayonto_recordid eq '11111111-2222-3333-4444-555555555555'"
        );
    });

    it("scopes the query to the field the mention was written in", async () => {
        // Without this, two mention-enabled columns on one record would read each
        // other's mentions.
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(firstQuery(harness).options).toContain("ayonto_sourcefield eq 'description'");
    });

    it("escapes an apostrophe so the OData literal stays intact", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list({
            ...context,
            sourceField: "o'brien",
        });

        expect(firstQuery(harness).options).toContain("ayonto_sourcefield eq 'o''brien'");
    });

    it("encodes a value that would otherwise cut the query string in half", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list({
            ...context,
            recordTable: "a&b?c",
        });

        expect(firstQuery(harness).options).toContain("ayonto_recordtable eq 'a%26b%3Fc'");
    });

    it("asks only for the columns it needs", async () => {
        const harness = makeWebApi();
        await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(firstQuery(harness).options).toContain(
            "$select=ayonto_mentionid,ayonto_recipientuserid,ayonto_recipientname,ayonto_recipientemail"
        );
    });

    it("parses a stored mention", async () => {
        const harness = makeWebApi([{ entities: [row()] }]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions).toEqual([
            {
                id: "0a0a0a0a-1111-2222-3333-444444444444",
                recipient: {
                    userId: "99999999-8888-7777-6666-555555555555",
                    name: "Alex Rivera",
                    email: "alex.rivera@example.invalid",
                },
            },
        ]);
    });

    it("normalizes stored ids", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({
                        ayonto_mentionid: "{0A0A0A0A-1111-2222-3333-444444444444}",
                        ayonto_recipientuserid: "{99999999-8888-7777-6666-555555555555}",
                    }),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions[0]?.id).toBe("0a0a0a0a-1111-2222-3333-444444444444");
        expect(mentions[0]?.recipient.userId).toBe("99999999-8888-7777-6666-555555555555");
    });

    it("reports a missing email as absent rather than empty", async () => {
        const harness = makeWebApi([{ entities: [row({ ayonto_recipientemail: null })] }]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions[0]?.recipient).not.toHaveProperty("email");
    });

    it("skips rows that cannot speak for a person", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_mentionid: null }),
                    row({ ayonto_recipientuserid: "" }),
                    row({ ayonto_recipientname: "   " }),
                    row(),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions).toHaveLength(1);
    });

    it("skips rows whose recipient columns are empty rather than blank", async () => {
        // A host reports an unset column as null, not as an empty string.
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_recipientuserid: null }),
                    row({ ayonto_recipientname: null }),
                    row(),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions).toHaveLength(1);
    });

    it("copes with a response that carries no paging link at all", async () => {
        const queries: RecordedQuery[] = [];
        const webAPI = {
            retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
                queries.push({ entity, options: options ?? "" });
                // No nextLink property, as a host may answer.
                return Promise.resolve({ entities: [row()] });
            }),
        } as unknown as ComponentFramework.WebApi;

        const mentions = await new DataverseMentionRepository(webAPI).list(context);

        expect(queries).toHaveLength(1);
        expect(mentions).toHaveLength(1);
    });

    it("skips a row whose mention id is not a string", async () => {
        const harness = makeWebApi([{ entities: [row({ ayonto_mentionid: 123 })] }]);

        await expect(
            new DataverseMentionRepository(harness.webAPI).list(context)
        ).resolves.toEqual([]);
    });

    it("skips a row whose recipient id is not a string", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_recipientuserid: 42 }),
                    row({ ayonto_mentionid: "obj", ayonto_recipientuserid: { id: "nested" } }),
                ],
            },
        ]);

        await expect(
            new DataverseMentionRepository(harness.webAPI).list(context)
        ).resolves.toEqual([]);
    });

    it("skips a row whose recipient name is not a string", async () => {
        // A schema mismatch must cost one row, not throw out of the repository.
        const harness = makeWebApi([{ entities: [row({ ayonto_recipientname: 123 })] }]);

        await expect(
            new DataverseMentionRepository(harness.webAPI).list(context)
        ).resolves.toEqual([]);
    });

    it("keeps a row whose email is not a string, without the email", async () => {
        const harness = makeWebApi([{ entities: [row({ ayonto_recipientemail: 1234 })] }]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions).toHaveLength(1);
        expect(mentions[0]?.recipient).not.toHaveProperty("email");
        expect(mentions[0]?.recipient.name).toBe("Alex Rivera");
    });

    it("skips entries that are not rows at all", async () => {
        const harness = makeWebApi([
            { entities: [null, undefined, 7, "text", [] as unknown] as Record<string, unknown>[] },
        ]);

        await expect(
            new DataverseMentionRepository(harness.webAPI).list(context)
        ).resolves.toEqual([]);
    });

    it("returns the valid rows that follow a malformed one on the same page", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_mentionid: "bad", ayonto_recipientname: 123 }),
                    row({ ayonto_mentionid: "good-1" }),
                    row({ ayonto_mentionid: "good-2" }),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions.map((mention) => mention.id)).toEqual(["good-1", "good-2"]);
    });

    it("keeps two people who share a display name apart", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_mentionid: "1a", ayonto_recipientuserid: "id-a", ayonto_recipientname: "Robin Fox" }),
                    row({ ayonto_mentionid: "1b", ayonto_recipientuserid: "id-b", ayonto_recipientname: "Robin Fox" }),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(ids(mentions)).toEqual(["id-a", "id-b"]);
    });

    it("keeps repeated mentions of the same person", async () => {
        const harness = makeWebApi([
            {
                entities: [
                    row({ ayonto_mentionid: "2a" }),
                    row({ ayonto_mentionid: "2b" }),
                ],
            },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions.map((mention) => mention.id)).toEqual(["2a", "2b"]);
        expect(new Set(ids(mentions)).size).toBe(1);
    });

    it("follows the paging link and combines the pages", async () => {
        const harness = makeWebApi([
            {
                entities: [row({ ayonto_mentionid: "page1" })],
                nextLink: "example.invalid/api/data/v9.2/ayonto_mention?$skiptoken=abc",
            },
            { entities: [row({ ayonto_mentionid: "page2" })] },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(mentions.map((mention) => mention.id)).toEqual(["page1", "page2"]);
        expect(harness.queries).toHaveLength(2);
        expect(harness.queries[1]?.options).toBe("?$skiptoken=abc");
    });

    it("cannot be made to loop by a repeated paging link", async () => {
        // A host that keeps handing back the same link would otherwise spin here
        // forever.
        // Scheme-free on purpose: a literal endpoint URL trips the power-apps
        // "use-relative-uri" rule, and the scheme is irrelevant here.
        const repeated = "example.invalid/api/data/v9.2/ayonto_mention?$skiptoken=same";
        const harness = makeWebApi([
            { entities: [row({ ayonto_mentionid: "first" })], nextLink: repeated },
            { entities: [row({ ayonto_mentionid: "second" })], nextLink: repeated },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(harness.queries).toHaveLength(2);
        expect(mentions.map((mention) => mention.id)).toEqual(["first", "second"]);
    });

    it("stops at a paging link that carries no query", async () => {
        const harness = makeWebApi([
            { entities: [row()], nextLink: "example.invalid/no-query" },
        ]);

        const mentions = await new DataverseMentionRepository(harness.webAPI).list(context);

        expect(harness.queries).toHaveLength(1);
        expect(mentions).toHaveLength(1);
    });

    it("turns a read failure into a neutral error", async () => {
        const detail = "Access denied at org-a1b2c3.example.invalid";
        const webAPI = {
            retrieveMultipleRecords: jest.fn(() => Promise.reject(new Error(detail))),
        } as unknown as ComponentFramework.WebApi;

        const failure = await new DataverseMentionRepository(webAPI)
            .list(context)
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(MentionRepositoryError);
        expect((failure as MentionRepositoryError).operation).toBe("read");
        expect((failure as Error).message).not.toContain(detail);
        expect((failure as Error).message).not.toContain("example.invalid");
    });

    it("does not log the failure", async () => {
        const errors: unknown[][] = [];
        const warnings: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
            errors.push(a);
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
            warnings.push(a);
        });

        try {
            const webAPI = {
                retrieveMultipleRecords: jest.fn(() => Promise.reject(new Error("Access denied"))),
            } as unknown as ComponentFramework.WebApi;

            await new DataverseMentionRepository(webAPI).list(context).catch(() => undefined);

            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });
});
