import { MentionRepositoryError } from "../domain/mentionPersistence";
import type {
    CreateMentionRequest,
    MentionRepository,
    MentionRecipient,
    PersistedMention,
} from "../domain/mentionPersistence";
import { normalizeDataverseId } from "../domain/recordContext";
import type { MentionRecordContext } from "../domain/recordContext";

/**
 * The logical contract this control expects of the Dataverse table. The
 * generated solution must implement exactly these names; nothing here creates
 * or alters schema.
 */
const TABLE = "ayonto_mention";
const COLUMN_ID = "ayonto_mentionid";
const COLUMN_NAME = "ayonto_name";
const COLUMN_RECIPIENT_USER_ID = "ayonto_recipientuserid";
const COLUMN_RECIPIENT_NAME = "ayonto_recipientname";
const COLUMN_RECIPIENT_EMAIL = "ayonto_recipientemail";
const COLUMN_RECORD_TABLE = "ayonto_recordtable";
const COLUMN_RECORD_ID = "ayonto_recordid";
const COLUMN_SOURCE_FIELD = "ayonto_sourcefield";

/** Only what `PersistedMention` is built from. */
const SELECT = [
    COLUMN_ID,
    COLUMN_RECIPIENT_USER_ID,
    COLUMN_RECIPIENT_NAME,
    COLUMN_RECIPIENT_EMAIL,
].join(",");

/** Escapes a value so it can be embedded in an OData string literal. */
function escapeODataLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

/**
 * Escapes for OData and then encodes for the URL. Without the encoding an "&"
 * or a "?" in a value would cut the query string in half, and a typed "%27"
 * would survive as a quote and undo the escaping.
 */
function literal(value: string): string {
    return encodeURIComponent(escapeODataLiteral(value));
}

/**
 * Reads a column, but only when it really holds a string.
 *
 * What comes back from the Web API is dynamic data: the framework types an
 * entity as an index signature of `any`, and the row reflects whatever the
 * environment's schema actually produced. A number, a boolean or a lookup
 * object where text was expected is therefore possible, and is reported as
 * absent rather than coerced — `String(123)` would invent a name nobody has.
 */
function readString(row: Record<string, unknown>, column: string): string | undefined {
    const value = row[column];
    return typeof value === "string" ? value : undefined;
}

/**
 * Turns a row into a mention, or nothing when the row cannot speak for a
 * person: without an id there is no record to point at, and without a user id
 * or a name there is nobody to name. Such rows are skipped rather than guessed
 * at, and so is anything that is not an object at all.
 *
 * The parameter is `unknown` on purpose. Asserting a trusted shape onto data
 * the platform supplies at runtime is what turns a schema mismatch into a
 * thrown `TypeError` halfway through a page instead of one skipped row.
 */
function toPersistedMention(row: unknown): PersistedMention | null {
    if (typeof row !== "object" || row === null) {
        return null;
    }

    // Safe after the check above. An array reaches this point too, and simply
    // has none of the columns, so it falls out with the required-value check.
    const columns = row as Record<string, unknown>;

    const id = normalizeDataverseId(readString(columns, COLUMN_ID) ?? "");
    const userId = normalizeDataverseId(readString(columns, COLUMN_RECIPIENT_USER_ID) ?? "");
    const name = (readString(columns, COLUMN_RECIPIENT_NAME) ?? "").trim();

    if (id.length === 0 || userId.length === 0 || name.length === 0) {
        return null;
    }

    // A malformed email does not cost the row: the mention still names someone.
    const email = (readString(columns, COLUMN_RECIPIENT_EMAIL) ?? "").trim();
    const recipient: MentionRecipient =
        email.length > 0 ? { userId, name, email } : { userId, name };

    return { id, recipient };
}

/**
 * The query part of a paging link, or null when there is no further page.
 *
 * `context.webAPI` offers no "follow this link" call, so the link's own query
 * string is handed back to `retrieveMultipleRecords` for the same table. The
 * parameter accepts `undefined` because a host may omit the field even though
 * the framework types it as a string.
 */
function nextPageOptions(nextLink: string | undefined): string | null {
    const link = (nextLink ?? "").trim();
    if (link.length === 0) {
        return null;
    }

    const query = link.indexOf("?");
    return query === -1 ? null : link.slice(query);
}

/**
 * Reads and writes `ayonto_mention` rows through the supported
 * `context.webAPI` surface.
 *
 * No `Xrm`, no form context, no undocumented API.
 * https://learn.microsoft.com/power-apps/developer/component-framework/reference/webapi
 */
export class DataverseMentionRepository implements MentionRepository {
    private readonly webAPI: ComponentFramework.WebApi;

    constructor(webAPI: ComponentFramework.WebApi) {
        this.webAPI = webAPI;
    }

    /**
     * Every mention written against this record *and* this field.
     *
     * All three parts are in the server-side filter on purpose. Scoping only by
     * record would let two mention-enabled columns on the same record read each
     * other's mentions.
     */
    public async list(context: MentionRecordContext): Promise<readonly PersistedMention[]> {
        const filter = [
            `${COLUMN_RECORD_TABLE} eq '${literal(context.recordTable)}'`,
            `${COLUMN_RECORD_ID} eq '${literal(context.recordId)}'`,
            `${COLUMN_SOURCE_FIELD} eq '${literal(context.sourceField)}'`,
        ].join(" and ");

        const mentions: PersistedMention[] = [];
        // Every page is requested at most once. A host that hands back a link it
        // has already given would otherwise spin here forever.
        const requested = new Set<string>();
        let options: string | null = `?$select=${SELECT}&$filter=${filter}`;

        while (options !== null && !requested.has(options)) {
            requested.add(options);

            let response: ComponentFramework.WebApi.RetrieveMultipleResponse;
            try {
                response = await this.webAPI.retrieveMultipleRecords(TABLE, options);
            } catch {
                // The original error is deliberately neither surfaced nor logged.
                throw new MentionRepositoryError("read");
            }

            for (const row of response.entities) {
                const mention = toPersistedMention(row);
                if (mention !== null) {
                    mentions.push(mention);
                }
            }

            options = nextPageOptions(response.nextLink);
        }

        return mentions;
    }

    /**
     * Writes the identity and context of one mention.
     *
     * Only what is known at this stage. Delivery state is left to the table's
     * own default: it becomes a Dataverse Choice, and inventing a numeric value
     * before the generated schema exists would bake in a guess.
     */
    public async create(request: CreateMentionRequest): Promise<PersistedMention> {
        const userId = normalizeDataverseId(request.recipient.userId);
        const name = request.recipient.name.trim();
        const email = (request.recipient.email ?? "").trim();

        // A mention nobody can be identified from is not worth a round trip, and
        // a row without an identity could never be acted on later.
        if (userId.length === 0 || name.length === 0) {
            throw new MentionRepositoryError("write");
        }

        const row: Record<string, string> = {
            [COLUMN_NAME]: `@${name}`,
            [COLUMN_RECIPIENT_USER_ID]: userId,
            [COLUMN_RECIPIENT_NAME]: name,
            [COLUMN_RECORD_TABLE]: request.context.recordTable,
            [COLUMN_RECORD_ID]: request.context.recordId,
            [COLUMN_SOURCE_FIELD]: request.context.sourceField,
        };
        if (email.length > 0) {
            row[COLUMN_RECIPIENT_EMAIL] = email;
        }

        let created: ComponentFramework.LookupValue;
        try {
            created = await this.webAPI.createRecord(TABLE, row);
        } catch {
            throw new MentionRepositoryError("write");
        }

        const recipient: MentionRecipient =
            email.length > 0 ? { userId, name, email } : { userId, name };

        return { id: normalizeDataverseId(created.id), recipient };
    }
}
