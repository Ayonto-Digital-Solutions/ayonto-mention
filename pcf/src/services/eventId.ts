/**
 * Identifiers for mention notifications.
 *
 * They are generated where the mention is made, travel with the record save, and
 * are what a later server-side step uses to make sure one mention becomes one
 * notification however often a payload is processed. That makes uniqueness the
 * whole point of them.
 *
 * `crypto.randomUUID` is the platform's own source: a version 4 UUID from a
 * cryptographically strong generator. `Math.random` is not one — its values are
 * neither unique nor unguessable — and an identifier built from a timestamp, the
 * record or the person's name would collide exactly when two mentions are made
 * at once, or would let one mention be mistaken for another.
 *
 * The API needs a secure context, which a Dataverse environment always is.
 */
export function createEventId(): string {
    return globalThis.crypto.randomUUID();
}
