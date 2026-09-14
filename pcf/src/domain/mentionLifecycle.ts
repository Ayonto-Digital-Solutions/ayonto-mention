/**
 * Platform-neutral description of the mentions an editor currently holds.
 *
 * Nothing here knows about React, Dataverse or the component framework: the
 * editor reports in these terms, and the later grace-period and notification
 * work consumes them.
 */

/**
 * One mention as it stands in the text right now.
 *
 * The **position** is part of the identity of an occurrence, not decoration.
 * The same person may be mentioned twice, two people may share a display name,
 * and deleting one occurrence must not be mistaken for deleting another. A set
 * of names, or a map from name to user, cannot express any of that.
 *
 * `userId` is who is meant. The display name never is: the text alone cannot
 * say which of two namesakes was picked.
 */
export interface MentionOccurrence {
    /** Index of the "@" that starts the mention. */
    readonly start: number;
    readonly name: string;
    readonly userId: string;
    /**
     * Carried through from the suggestion that was picked, when it had one.
     * Never derived from the text and never looked up again.
     */
    readonly email?: string | undefined;
}

/**
 * True when two snapshots describe the same mentions in the same places.
 *
 * Used to keep a re-render from being mistaken for a change: a report is worth
 * sending only when the set of occurrences actually differs.
 */
export function sameMentionOccurrences(
    left: readonly MentionOccurrence[],
    right: readonly MentionOccurrence[]
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((occurrence, index) => {
        const other = right[index];
        // The lengths match, so the counterpart is always there: the missing one is
        // unreachable on the editor's normal path and the indexed read is only typed
        // as optional because of `noUncheckedIndexedAccess`. The runtime guard is kept
        // on purpose all the same. Optional chaining would satisfy the rule but
        // instrument four short-circuit branches that can never be taken, which costs
        // real branch coverage on this file and buys nothing.
        return (
            // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
            other !== undefined &&
            occurrence.start === other.start &&
            occurrence.name === other.name &&
            occurrence.userId === other.userId &&
            occurrence.email === other.email
        );
    });
}
