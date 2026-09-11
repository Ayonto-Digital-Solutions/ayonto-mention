import type { MentionRecordContext } from "./recordContext";

/**
 * Platform-neutral contract for storing and reading the mentions written on a
 * record's field.
 *
 * Nothing here knows about Dataverse or the component framework: the editor and
 * the later notification work depend on this contract, an adapter in
 * `../services` fulfils it, and a test double can stand in for that adapter.
 */

/** The person a mention names. The id is the identity, never the display name. */
export interface MentionRecipient {
    readonly userId: string;
    readonly name: string;
    readonly email?: string | undefined;
}

/** A mention that exists in the store. */
export interface PersistedMention {
    readonly id: string;
    readonly recipient: MentionRecipient;
}

export interface CreateMentionRequest {
    readonly context: MentionRecordContext;
    readonly recipient: MentionRecipient;
}

export interface MentionRepository {
    /** Every mention written against exactly this record *and* field. */
    list(context: MentionRecordContext): Promise<readonly PersistedMention[]>;
    create(request: CreateMentionRequest): Promise<PersistedMention>;
}

/** Which half of the contract failed, so a caller can word its message. */
export type MentionRepositoryOperation = "read" | "write";

/**
 * A neutral failure.
 *
 * Deliberately carries no detail from the underlying store: a Dataverse error
 * can hold the environment URL and schema names, and neither belongs in a
 * message a user may see or in a log. The operation is the only thing a caller
 * needs to tell "could not be loaded" from "could not be saved".
 */
export class MentionRepositoryError extends Error {
    public readonly operation: MentionRepositoryOperation;

    constructor(operation: MentionRepositoryOperation) {
        super(
            operation === "read"
                ? "Mentions could not be loaded."
                : "The mention could not be saved."
        );
        this.name = "MentionRepositoryError";
        this.operation = operation;
        // Keeps `instanceof` working when the class is compiled down.
        Object.setPrototypeOf(this, MentionRepositoryError.prototype);
    }
}
