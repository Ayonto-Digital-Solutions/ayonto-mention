/**
 * How tall the mention field is at its smallest, counted in rows of text.
 *
 * A model-driven form knows how tall a maker drew the field — it is the cell's
 * rowspan — and tells a code component nothing about it: `allocatedHeight` is
 * `-1` there, with or without `trackContainerResize`. The only supported way to
 * learn it is to be told, so the maker configures it, and everything here is
 * about making whatever they configured safe to use.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 */

/** A field with no room for a line of text is a mistake. */
export const MIN_FIELD_ROWS = 1;
/** Thirty rows is already most of a screen; past that a form is being misused. */
export const MAX_FIELD_ROWS = 30;
/** What the property ships with, and what an unusable value falls back to. */
export const DEFAULT_FIELD_ROWS = 3;

/**
 * Brings a configured row count into a range that cannot break a form.
 *
 * The value arrives from a plain whole-number property a person types into, so 0
 * and 500 are each one keystroke away, an empty property arrives as `null`, and a
 * host that hands over something else entirely — a string from a test harness, a
 * `NaN` — must not be able to produce a field with no height or a field taller
 * than the form.
 *
 * Out of range clamps to the nearest end, because a maker who typed 90 wants a
 * tall field and should get the tallest one available rather than silently
 * getting the default. Unreadable falls back to the default instead: there is no
 * intent to honour.
 */
export function clampFieldRows(raw: unknown): number {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return DEFAULT_FIELD_ROWS;
    }

    return Math.min(Math.max(Math.round(raw), MIN_FIELD_ROWS), MAX_FIELD_ROWS);
}
