import { DataverseMentionRepository } from "../src/services/dataverseMentionRepository";
import { MentionRepositoryError } from "../src/domain/mentionPersistence";
import type {
    CreateMentionRequest,
    MentionRepository,
} from "../src/domain/mentionPersistence";
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

/**
 * A Web API that records what it is asked.
 *
 * It can answer a retrieve, and nothing in this repository ever sends one — the
 * recorded queries are what proves that.
 */
function makeWebApi(createdId = "AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB"): Harness {
    const creates: RecordedCreate[] = [];
    const queries: RecordedQuery[] = [];

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
                return Promise.resolve({ entities: [], nextLink: "" });
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

const firstCreate = (harness: Harness): RecordedCreate => {
    const create = harness.creates[0];
    if (create === undefined) {
        throw new Error("expected at least one create");
    }
    return create;
};

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
        const harness = makeWebApi("{AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB}");

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
        expect((failure as Error).message).toBe("The mention could not be saved.");
        expect((failure as Error).message).not.toContain(detail);
        expect((failure as Error).message).not.toContain("example.invalid");
    });

    it("does not log the failure either", async () => {
        // A Dataverse error can carry the environment URL and schema names with
        // it, so it is neither surfaced nor written anywhere.
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
                createRecord: jest.fn(() => Promise.reject(new Error("Access denied"))),
            } as unknown as ComponentFramework.WebApi;

            await new DataverseMentionRepository(webAPI).create(request()).catch(() => undefined);

            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });
});

describe("the v1 persistence contract", () => {
    /**
     * Compile-time proof that the contract is write-only: every member of
     * `MentionRepository` must appear here, so adding a read back to the
     * interface stops the build until that decision is made deliberately.
     */
    const CONTRACT: Record<keyof MentionRepository, true> = { create: true };

    it("offers writing as its only persistence entry point", () => {
        expect(Object.keys(CONTRACT)).toEqual(["create"]);
    });

    it("never asks the mention table anything", async () => {
        const harness = makeWebApi();

        await new DataverseMentionRepository(harness.webAPI).create(request());

        // Reading the rows back cannot reconstruct current mention state, so v1
        // does not read them at all. User search has its own service and is not
        // affected.
        expect(harness.queries).toEqual([]);
    });
});
