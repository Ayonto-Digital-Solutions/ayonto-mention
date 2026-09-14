import { MentionRepositoryError } from "../domain/mentionPersistence";
import type {
    CreateMentionRequest,
    MentionRepository,
    MentionRecipient,
    PersistedMention,
} from "../domain/mentionPersistence";
import { normalizeDataverseId } from "../domain/recordContext";

/**
 * The logical contract this control expects of the Dataverse table. The
 * generated solution must implement exactly these names; nothing here creates
 * or alters schema.
 */
const TABLE = "ayonto_mention";
const COLUMN_NAME = "ayonto_name";
const COLUMN_RECIPIENT_USER_ID = "ayonto_recipientuserid";
const COLUMN_RECIPIENT_NAME = "ayonto_recipientname";
const COLUMN_RECIPIENT_EMAIL = "ayonto_recipientemail";
const COLUMN_RECORD_TABLE = "ayonto_recordtable";
const COLUMN_RECORD_ID = "ayonto_recordid";
const COLUMN_SOURCE_FIELD = "ayonto_sourcefield";

/**
 * Writes `ayonto_mention` rows through the supported `context.webAPI` surface.
 *
 * Write-only, matching the contract: v1 records that a mention was made and
 * never reads the rows back, so this class asks the mention table nothing.
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
            throw new MentionRepositoryError();
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
            throw new MentionRepositoryError();
        }

        const recipient: MentionRecipient =
            email.length > 0 ? { userId, name, email } : { userId, name };

        return { id: normalizeDataverseId(created.id), recipient };
    }
}
