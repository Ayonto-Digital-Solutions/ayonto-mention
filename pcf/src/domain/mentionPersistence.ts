import type { MentionRecordContext } from "./recordContext";

/**
 * Platform-neutral contract for recording the mentions written on a record's
 * field.
 *
 * Writing only, and deliberately so. A stored mention says that a person was
 * mentioned on this record's field at a point in time; it does not say whether
 * the text still names them today. Reading the rows back cannot reconstruct
 * that: nothing retires a row, the component framework offers no durable save
 * signal to tie one to, and a row does not say which occurrence of a repeated
 * name it belonged to. So v1 does not claim it can, and the contract offers no
 * read. Current mention identity lives in the editing session.
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

/** A mention that was written to the store. */
export interface PersistedMention {
    readonly id: string;
    readonly recipient: MentionRecipient;
}

export interface CreateMentionRequest {
    readonly context: MentionRecordContext;
    readonly recipient: MentionRecipient;
}

export interface MentionRepository {
    create(request: CreateMentionRequest): Promise<PersistedMention>;
}

/**
 * A neutral failure.
 *
 * Deliberately carries no detail from the underlying store: a Dataverse error
 * can hold the environment URL and schema names, and neither belongs in a
 * message a user may see or in a log.
 *
 * There is one thing that can fail, so the error does not discriminate between
 * operations. A read half would be API for something v1 does not do.
 */
export class MentionRepositoryError extends Error {
    constructor() {
        super("The mention could not be saved.");
        this.name = "MentionRepositoryError";
        // Keeps `instanceof` working when the class is compiled down.
        Object.setPrototypeOf(this, MentionRepositoryError.prototype);
    }
}
