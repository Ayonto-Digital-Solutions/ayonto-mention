import type {
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../domain/userSearch";

/**
 * Escapes a value so it can be embedded in an OData string literal.
 *
 * This lives in the service layer rather than the domain: it is a detail of how
 * Dataverse is queried, not of what a mention means.
 */
function escapeODataLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

/** The shape of a systemuser row, as far as this lookup reads it. */
interface SystemUserRecord {
    systemuserid?: string;
    fullname?: string;
    internalemailaddress?: string | null;
    jobtitle?: string | null;
    applicationid?: string | null;
    accessmode?: number | null;
}

const SELECT = "systemuserid,fullname,internalemailaddress,jobtitle,applicationid,accessmode";

/** Access modes that cannot hold a mailbox: 3 = Support User, 4 = Non-interactive. */
const UNMAILABLE_ACCESS_MODES = [3, 4];

const DEFAULT_PAGE_SIZE = 10;

/** True for the accounts that exist to run code, not to receive a mention. */
function isServiceAccount(entity: SystemUserRecord): boolean {
    const applicationId = entity.applicationid;
    const isApplicationUser =
        applicationId !== null && applicationId !== undefined && applicationId.length > 0;

    return isApplicationUser || UNMAILABLE_ACCESS_MODES.includes(entity.accessmode ?? 0);
}

/**
 * Looks enabled Dataverse users up through the supported `context.webAPI` surface.
 *
 * That surface only offers CRUD operations, so the query is expressed as OData.
 * No `Xrm`, no form context, no undocumented API.
 * https://learn.microsoft.com/power-apps/developer/component-framework/reference/webapi
 */
export class DataverseUserSearchService implements UserSearchProvider {
    private readonly webAPI: ComponentFramework.WebApi;
    private readonly pageSize: number;

    constructor(webAPI: ComponentFramework.WebApi, pageSize: number = DEFAULT_PAGE_SIZE) {
        this.webAPI = webAPI;
        this.pageSize = pageSize;
    }

    public async search(term: string): Promise<UserSearchResult> {
        const filters = ["isdisabled eq false"];
        const trimmed = term.trim();
        if (trimmed.length > 0) {
            // The literal is escaped for OData and then encoded for the URL. Without
            // the encoding an "&" or a "?" in a name would cut the query string in
            // half, and a typed "%27" would survive as a quote and undo the escaping.
            const literal = encodeURIComponent(escapeODataLiteral(trimmed));
            filters.push(`contains(fullname,'${literal}')`);
        }

        // Application users and the built-in support accounts have no mailbox to
        // write to. The server excludes them rather than the loop below, because
        // dropping them from an already full page leaves the list short — or empty —
        // as soon as enough of them sort to the front of the alphabet.
        const mailable = [
            "applicationid eq null",
            ...UNMAILABLE_ACCESS_MODES.map((mode) => `accessmode ne ${mode.toString()}`),
        ];

        try {
            // One more than the page size, so a full page can be told apart from a
            // truncated result.
            return await this.query([...filters, ...mailable], this.pageSize + 1);
        } catch {
            // An organisation that will not filter on those columns must not lose the
            // lookup altogether. The same query without them still works, and the
            // check in the loop still keeps those accounts out of the list — it can
            // only leave the list short, so the surplus is doubled to leave room for
            // the ones that drop out.
            //
            // The original error is deliberately not logged: a Dataverse failure can
            // carry the environment URL and schema details with it.
            console.warn(
                "[AyontoMention] User lookup rejected the service-account filters; retrying without them."
            );
            return await this.query(filters, this.pageSize * 2 + 1);
        }
    }

    private async query(filters: readonly string[], limit: number): Promise<UserSearchResult> {
        const options =
            `?$select=${SELECT}` +
            `&$filter=${filters.join(" and ")}` +
            `&$orderby=fullname asc` +
            `&$top=${limit.toString()}`;

        const response = await this.webAPI.retrieveMultipleRecords("systemuser", options, limit);
        const records = response.entities as SystemUserRecord[];

        const suggestions: UserSuggestion[] = [];
        let hasMore = false;

        for (const entity of records) {
            const id = entity.systemuserid;
            const name = entity.fullname;

            // A row without an identity or a name cannot be offered, and the service
            // accounts are dropped here too — the server may have been asked to leave
            // them out, but on the fallback query it was not.
            if (
                id === undefined ||
                id.length === 0 ||
                name === undefined ||
                name.length === 0 ||
                isServiceAccount(entity)
            ) {
                continue;
            }

            // The extra record that was requested only proves there is more once it
            // survives every check above.
            if (suggestions.length === this.pageSize) {
                hasMore = true;
                break;
            }

            suggestions.push({
                id,
                name,
                email: entity.internalemailaddress ?? undefined,
                jobTitle: entity.jobtitle ?? undefined,
            });
        }

        return { users: suggestions, hasMore };
    }
}
