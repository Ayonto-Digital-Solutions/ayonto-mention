import { DataverseUserSearchService } from "../src/services/dataverseUserSearchService";
import type {
    UserDirectory,
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../src/domain/userSearch";

interface RecordedCall {
    readonly entity: string;
    readonly options: string;
    readonly maxPageSize: number | undefined;
}

function makeWebApi(
    entities: readonly Record<string, unknown>[],
    recorded: RecordedCall[] = []
): ComponentFramework.WebApi {
    return {
        retrieveMultipleRecords: jest.fn((entity: string, options?: string, maxPageSize?: number) => {
            recorded.push({ entity, options: options ?? "", maxPageSize });
            return Promise.resolve({ entities: [...entities], nextLink: "" });
        }),
    } as unknown as ComponentFramework.WebApi;
}

/** A systemuser row. Every value is fictional. */
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    systemuserid: "u-alex",
    fullname: "Alex Rivera",
    internalemailaddress: "alex.rivera@example.invalid",
    jobtitle: "Support Lead",
    ...over,
});

/** Reads a recorded call or fails loudly, so the tests need no non-null assertions. */
function callAt(recorded: readonly RecordedCall[], index: number): RecordedCall {
    const call = recorded[index];
    if (call === undefined) {
        throw new Error(`expected a Web API call at index ${index.toString()}`);
    }
    return call;
}

function onlyUser(result: UserSearchResult): UserSuggestion {
    const [first, ...rest] = result.users;
    if (first === undefined || rest.length > 0) {
        throw new Error(`expected exactly one user, got ${result.users.length.toString()}`);
    }
    return first;
}

const filterLiteral = (options: string): string =>
    /contains\(fullname,'([^']*(?:''[^']*)*)'\)/.exec(options)?.[1] ?? "";

const ids = (result: UserSearchResult): readonly string[] => result.users.map((user) => user.id);

describe("DataverseUserSearchService", () => {
    // The fallback path warns. Capture it so the suite stays quiet and the warning
    // itself can be asserted on.
    const warnings: unknown[][] = [];
    let restoreWarn: () => void = () => undefined;

    beforeEach(() => {
        warnings.length = 0;
        const spy = jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
            warnings.push(args);
        });
        restoreWarn = () => {
            spy.mockRestore();
        };
    });

    afterEach(() => {
        restoreWarn();
    });

    it("queries the systemuser table, excludes disabled users and sorts by name", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("Ale");

        expect(callAt(recorded, 0).entity).toBe("systemuser");
        expect(callAt(recorded, 0).options).toContain("isdisabled eq false");
        expect(callAt(recorded, 0).options).toContain("$orderby=fullname asc");
    });

    it("filters on the typed term and trims it", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("  Ale  ");

        expect(callAt(recorded, 0).options).toContain("contains(fullname,'Ale')");
    });

    it("escapes a quote in the term so the OData literal stays intact", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("O'Brien");

        // Doubling is the OData escape; encodeURIComponent deliberately leaves a
        // quote alone, and a doubled quote inside the literal is unambiguous.
        expect(callAt(recorded, 0).options).toContain("contains(fullname,'O''Brien')");
    });

    it("encodes a term that would otherwise cut the query string in half", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("Alex &");

        // A raw "&" would start a new query parameter and truncate the filter.
        expect(filterLiteral(callAt(recorded, 0).options)).toBe("Alex%20%26");
    });

    it("encodes characters that would otherwise be read as query syntax", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("a?b=c");

        expect(filterLiteral(callAt(recorded, 0).options)).toBe("a%3Fb%3Dc");
    });

    it("does not let a typed percent sequence turn back into a quote", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("%27 or 1 eq 1");

        // %2527 decodes to the text "%27", not to a quote that would end the literal.
        expect(filterLiteral(callAt(recorded, 0).options)).toBe("%2527%20or%201%20eq%201");
    });

    it("omits the name filter for an empty term, listing the first users instead", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("");

        expect(callAt(recorded, 0).options).not.toContain("contains(fullname");
        expect(callAt(recorded, 0).options).toContain("$filter=isdisabled eq false");
    });

    it("maps a record onto a suggestion", async () => {
        const result = await new DataverseUserSearchService(makeWebApi([row()])).search("Ale");

        expect(result.users).toEqual([
            {
                id: "u-alex",
                name: "Alex Rivera",
                email: "alex.rivera@example.invalid",
                jobTitle: "Support Lead",
            },
        ]);
    });

    it("leaves out the built-in accounts that have no mailbox", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([
                row(),
                row({ systemuserid: "u-support", fullname: "SUPPORT USER", accessmode: 3 }),
                row({ systemuserid: "u-integration", fullname: "INTEGRATION", accessmode: 4 }),
            ])
        ).search("");

        expect(ids(result)).toEqual(["u-alex"]);
    });

    it("keeps ordinary and administrative users", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([
                row({ accessmode: 0 }),
                row({ systemuserid: "u-dana", fullname: "Dana Winter", accessmode: 1 }),
            ])
        ).search("");

        expect(ids(result)).toEqual(["u-alex", "u-dana"]);
    });

    it("leaves out application users, which cannot receive mail", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([
                row(),
                row({ systemuserid: "u-app", fullname: "Portal App", applicationid: "app-1" }),
            ])
        ).search("");

        expect(ids(result)).toEqual(["u-alex"]);
    });

    it("skips malformed records without an id or a name", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([
                row({ systemuserid: undefined }),
                row({ systemuserid: "u-nameless", fullname: undefined }),
                row(),
            ])
        ).search("");

        expect(ids(result)).toEqual(["u-alex"]);
    });

    it("never returns more than the page size", async () => {
        const many = Array.from({ length: 40 }, (_, index) =>
            row({ systemuserid: `u-${index.toString()}` })
        );
        const result = await new DataverseUserSearchService(makeWebApi(many), 5).search("");

        expect(result.users).toHaveLength(5);
    });

    it("reports that the source had more matches than fit in the list", async () => {
        const many = Array.from({ length: 40 }, (_, index) =>
            row({ systemuserid: `u-${index.toString()}` })
        );
        const result = await new DataverseUserSearchService(makeWebApi(many), 5).search("Ale");

        expect(result.hasMore).toBe(true);
    });

    it("does not claim more matches when the result fits", async () => {
        const few = Array.from({ length: 3 }, (_, index) =>
            row({ systemuserid: `u-${index.toString()}` })
        );
        const result = await new DataverseUserSearchService(makeWebApi(few), 5).search("Ale");

        expect(result.hasMore).toBe(false);
    });

    it("does not claim more matches when the surplus is only a service account", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([
                row({ systemuserid: "u-1" }),
                row({ systemuserid: "u-2" }),
                row({ systemuserid: "u-app", applicationid: "app-1" }),
            ]),
            2
        ).search("Ale");

        expect(result.users).toHaveLength(2);
        expect(result.hasMore).toBe(false);
    });

    it("asks for one more than it shows, so truncation can be detected", async () => {
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded), 10).search("Ale");

        expect(callAt(recorded, 0).options).toContain("$top=11");
        expect(callAt(recorded, 0).maxPageSize).toBe(11);
    });

    it("has the server leave out the accounts without a mailbox", async () => {
        // Dropping them from a full page afterwards is what leaves the list short,
        // so the query asks for a page that does not hold them in the first place.
        const recorded: RecordedCall[] = [];
        await new DataverseUserSearchService(makeWebApi([], recorded)).search("Ale");

        expect(callAt(recorded, 0).options).toContain("applicationid eq null");
        expect(callAt(recorded, 0).options).toContain("accessmode ne 3");
        expect(callAt(recorded, 0).options).toContain("accessmode ne 4");
    });

    it("still finds users on an organisation that refuses to filter on those columns", async () => {
        const recorded: RecordedCall[] = [];
        const records = [row(), row({ systemuserid: "u-app", applicationid: "app-1" })];
        const webAPI = {
            retrieveMultipleRecords: jest.fn(
                (entity: string, options?: string, maxPageSize?: number) => {
                    recorded.push({ entity, options: options ?? "", maxPageSize });
                    return (options ?? "").includes("applicationid eq null")
                        ? Promise.reject(new Error("Could not find a property named 'applicationid'"))
                        : Promise.resolve({ entities: records, nextLink: "" });
                }
            ),
        } as unknown as ComponentFramework.WebApi;

        const result = await new DataverseUserSearchService(webAPI, 10).search("Ale");

        // The second query carries neither exclusion, and asks for the wider page
        // that leaves room for what the loop then drops locally.
        expect(recorded).toHaveLength(2);
        expect(callAt(recorded, 1).options).not.toContain("applicationid eq null");
        expect(callAt(recorded, 1).options).not.toContain("accessmode ne");
        expect(callAt(recorded, 1).options).toContain("$top=21");
        expect(ids(result)).toEqual(["u-alex"]);
    });

    it("does not put the Dataverse failure into the log", async () => {
        // A Dataverse error can carry the environment URL and schema details with it.
        // Scheme-free on purpose: a literal endpoint URL trips the power-apps
        // "use-relative-uri" lint rule, and the scheme is irrelevant to the test.
        const detail = "org-a1b2c3.example.invalid/api/data/v9.2/systemuser";
        const webAPI = {
            retrieveMultipleRecords: jest.fn((_entity: string, options?: string) =>
                (options ?? "").includes("applicationid eq null")
                    ? Promise.reject(new Error(`Could not find a property named 'applicationid' at ${detail}`))
                    : Promise.resolve({ entities: [row()], nextLink: "" })
            ),
        } as unknown as ComponentFramework.WebApi;

        await new DataverseUserSearchService(webAPI).search("Ale");

        expect(warnings).toHaveLength(1);
        const [logged = []] = warnings;
        // A single string argument: no error object is handed to the console.
        expect(logged).toHaveLength(1);
        expect(typeof logged[0]).toBe("string");
        expect(String(logged[0])).not.toContain(detail);
    });

    it("reports a lookup that fails both ways rather than returning nothing", async () => {
        const webAPI = {
            retrieveMultipleRecords: jest.fn(() => Promise.reject(new Error("Access denied"))),
        } as unknown as ComponentFramework.WebApi;

        await expect(new DataverseUserSearchService(webAPI).search("Ale")).rejects.toThrow(
            "Access denied"
        );
    });

    it("reports a missing email as absent rather than empty", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([row({ internalemailaddress: null })])
        ).search("Ale");

        expect(onlyUser(result).email).toBeUndefined();
    });

    it("reports a missing job title as absent rather than empty", async () => {
        const result = await new DataverseUserSearchService(
            makeWebApi([row({ jobtitle: null })])
        ).search("Ale");

        expect(onlyUser(result).jobTitle).toBeUndefined();
    });

    it("preserves email and job title when the record carries them", async () => {
        const result = await new DataverseUserSearchService(makeWebApi([row()])).search("Ale");

        expect(onlyUser(result).email).toBe("alex.rivera@example.invalid");
        expect(onlyUser(result).jobTitle).toBe("Support Lead");
    });
});

describe("domain and adapter boundary", () => {
    /** A consumer that knows the contract and nothing about Dataverse. */
    async function namesFrom(
        provider: UserSearchProvider,
        term: string
    ): Promise<readonly string[]> {
        const result = await provider.search(term);
        return result.users.map((user) => user.name);
    }

    it("exposes the Dataverse service through the platform-neutral contract", async () => {
        const provider: UserSearchProvider = new DataverseUserSearchService(makeWebApi([row()]));

        await expect(namesFrom(provider, "Ale")).resolves.toEqual(["Alex Rivera"]);
    });

    it("lets a test double stand in for the Dataverse service", async () => {
        const provider: UserSearchProvider = {
            search: () =>
                Promise.resolve({
                    users: [{ id: "u-dana", name: "Dana Winter" }],
                    hasMore: false,
                }),
        };

        await expect(namesFrom(provider, "Dan")).resolves.toEqual(["Dana Winter"]);
    });
});

describe("confirming who an id belongs to", () => {
    interface Lookup {
        readonly entity: string;
        readonly id: string;
        readonly options: string;
    }

    function makeDirectory(
        answer: (id: string) => Promise<Record<string, unknown>>,
        looked: Lookup[] = []
    ): { service: DataverseUserSearchService; looked: Lookup[] } {
        const webAPI = {
            retrieveRecord: jest.fn((entity: string, id: string, options?: string) => {
                looked.push({ entity, id, options: options ?? "" });
                return answer(id);
            }),
        } as unknown as ComponentFramework.WebApi;

        return { service: new DataverseUserSearchService(webAPI), looked };
    }

    it("asks Dataverse for that user's name, and nothing else about them", async () => {
        const { service, looked } = makeDirectory(() =>
            Promise.resolve({ systemuserid: "u-alex", fullname: "Alex Rivera" })
        );

        await expect(service.resolveName("u-alex")).resolves.toBe("Alex Rivera");
        expect(looked).toEqual([
            { entity: "systemuser", id: "u-alex", options: "?$select=systemuserid,fullname" },
        ]);
    });

    it("trims the name, as a display name may be stored padded", async () => {
        const { service } = makeDirectory(() => Promise.resolve({ fullname: "  Alex Rivera  " }));

        await expect(service.resolveName("u-alex")).resolves.toBe("Alex Rivera");
    });

    it("answers with nobody when the record carries no usable name", async () => {
        for (const fullname of ["", "   ", undefined, null, 7]) {
            const { service } = makeDirectory(() => Promise.resolve({ fullname }));

            await expect(service.resolveName("u-alex")).resolves.toBeNull();
        }
    });

    it("answers with nobody when the user cannot be read", async () => {
        // Deleted, out of scope for this user, or simply unreachable: from here
        // they are all the same answer, and none of them is a confirmation.
        const { service } = makeDirectory(() =>
            Promise.reject(new Error("denied at https://org-a1b2.example.invalid"))
        );

        await expect(service.resolveName("u-alex")).resolves.toBeNull();
    });

    it("keeps the environment out of the log when a lookup fails", async () => {
        const noise: unknown[][] = [];
        const record = (...args: unknown[]): void => {
            noise.push(args);
        };
        const warn = jest.spyOn(console, "warn").mockImplementation(record);
        const error = jest.spyOn(console, "error").mockImplementation(record);
        const { service } = makeDirectory(() =>
            Promise.reject(new Error("denied at https://org-a1b2.example.invalid"))
        );

        await service.resolveName("u-alex");

        // A Dataverse failure carries the organisation URL and the schema names
        // with it. None of that belongs anywhere a browser keeps it.
        expect(noise).toEqual([]);
        warn.mockRestore();
        error.mockRestore();
    });

    it("is the platform-neutral directory the editor asks", async () => {
        const { service } = makeDirectory(() => Promise.resolve({ fullname: "Alex Rivera" }));
        const directory: UserDirectory = service;

        await expect(directory.resolveName("u-alex")).resolves.toBe("Alex Rivera");
    });
});
