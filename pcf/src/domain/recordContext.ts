/**
 * The record a mention would be written against, in normalized form.
 *
 * Pure and platform-neutral: no Web API, no React, no component framework
 * types. It turns whatever a host happens to supply into either a complete,
 * normalized context or nothing at all — a half-filled context would only push
 * the question of whether it is usable onto every caller.
 */

/** A record context that is complete enough to persist a mention against. */
export interface MentionRecordContext {
    /** Dataverse record id, without braces and lower-cased. */
    readonly recordId: string;
    /** Logical table name, lower-cased. */
    readonly recordTable: string;
    /** Logical name of the column the text lives in, lower-cased. */
    readonly sourceField: string;
}

/** What a host can offer, before any of it is known to be usable. */
export interface RecordContextInput {
    readonly recordId: string | null | undefined;
    readonly recordTable: string | null | undefined;
    readonly sourceField: string | null | undefined;
}

/**
 * Dataverse hands record ids out both bare and wrapped in braces, and in either
 * case.
 *
 * Only the *surrounding* pair is removed, and only when both halves are there.
 * Stripping every brace in the string would quietly rewrite a value that merely
 * contains one, and an unmatched brace is far more likely to be part of the
 * value than a wrapper the platform forgot to close.
 *
 * The shape itself is deliberately not validated: the id comes from the
 * platform, and a control that second-guesses it would reject records it should
 * have accepted.
 */
export function normalizeDataverseId(value: string): string {
    const trimmed = value.trim();
    const unwrapped =
        trimmed.length >= 2 && trimmed.startsWith("{") && trimmed.endsWith("}")
            ? trimmed.slice(1, -1)
            : trimmed;

    return unwrapped.trim().toLowerCase();
}

/** The shape of a Dataverse record id, once braces and case are normalized away. */
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * True when a value really is a Dataverse record id.
 *
 * For ids that did *not* come from the platform. The record this control is
 * bound to is taken as given — see `normalizeDataverseId` — but a recipient read
 * out of a stored payload is something a stranger may have written, and it ends
 * up in a Web API call and in a navigation. Both should be handed an id or
 * nothing at all.
 *
 * @param value An already normalized id.
 */
export function isDataverseId(value: string): boolean {
    return RECORD_ID.test(value);
}

/** Logical names are case-insensitive in Dataverse and are compared as lower case. */
function normalizeLogicalName(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * True when two contexts point at the same record, table and column.
 *
 * Compared by value, never by reference: `resolveRecordContext` builds a new
 * object on every host update, so two identical contexts are never the same
 * object, and a reference check would read every render as a record change.
 * Both sides are already normalized, so the fields compare directly.
 */
export function sameRecordContext(
    left: MentionRecordContext | null,
    right: MentionRecordContext | null
): boolean {
    if (left === null || right === null) {
        return left === right;
    }

    return (
        left.recordId === right.recordId &&
        left.recordTable === right.recordTable &&
        left.sourceField === right.sourceField
    );
}

/**
 * Normalizes a host-supplied record context.
 *
 * Returns `null` when the record cannot be written against yet — most commonly
 * on a form for a record that has not been saved, where the id is still empty.
 * A missing table or column name means the same thing: there is nothing to
 * anchor a mention to. Callers therefore only ever see a context that is
 * complete, and never have to re-check its parts.
 *
 * The input is only read; nothing is mutated.
 */
export function resolveRecordContext(input: RecordContextInput): MentionRecordContext | null {
    const recordId = normalizeDataverseId(input.recordId ?? "");
    const recordTable = normalizeLogicalName(input.recordTable ?? "");
    const sourceField = normalizeLogicalName(input.sourceField ?? "");

    if (recordId.length === 0 || recordTable.length === 0 || sourceField.length === 0) {
        return null;
    }

    return { recordId, recordTable, sourceField };
}
