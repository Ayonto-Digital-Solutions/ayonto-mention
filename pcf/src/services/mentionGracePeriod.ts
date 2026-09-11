import { normalizeDataverseId } from "../domain/recordContext";
import type { MentionOccurrence } from "../domain/mentionLifecycle";

/**
 * How long a mention is held before the person is told about it.
 *
 * A mention lands in the text the moment it is picked, but the notification must
 * not: picking the wrong entry off a list happens, and "you were mentioned"
 * cannot be taken back. Deleting the mention again within this window is the one
 * thing that stops it.
 */
export const MENTION_GRACE_PERIOD_MS = 5000;

/** A copy with no shared references, so a caller cannot reach in afterwards. */
function copyOccurrence(occurrence: MentionOccurrence): MentionOccurrence {
    return occurrence.email === undefined
        ? { start: occurrence.start, name: occurrence.name, userId: occurrence.userId }
        : {
              start: occurrence.start,
              name: occurrence.name,
              userId: occurrence.userId,
              email: occurrence.email,
          };
}

interface Waiting {
    /**
     * Ends the wait now, subject to the same checks the timer would make. It
     * owns its own timer handle, so ending a wait needs no lookup and no case
     * for an entry that is already gone.
     */
    readonly fire: () => void;
}

/**
 * Holds notifications back for a grace period and drops the ones whose mention
 * is gone by the time they would go out.
 *
 * Free of React, the component framework, the Web API and any repository, so the
 * timing, the de-duplication and the withdrawal rule can be exercised directly.
 *
 * Two things are deliberately different from a scheduler that only re-checks
 * when its timer fires:
 *
 * 1. **A withdrawal cancels immediately.** Leaving the timer alive and asking
 *    again on expiry means a mention removed at t=2 and made again at t=4 would
 *    be delivered at t=5 on the *old* clock. Each mention deserves the full
 *    window, so the timer is cleared the moment the last occurrence of that
 *    person disappears, and a later mention starts a new one.
 * 2. **The payload is resolved when the timer fires**, not captured when it is
 *    scheduled. The occurrence that was picked may since have been deleted while
 *    another occurrence of the same person survives, positions move, and two
 *    occurrences of one person may carry different addresses. What goes out has
 *    to describe the mention that is actually there.
 */
export class MentionGracePeriod {
    private readonly onReady: (mention: MentionOccurrence) => Promise<void>;
    private readonly delayMs: number;

    /** The mentions standing in the text, by normalized recipient id. */
    private readonly written = new Map<string, MentionOccurrence[]>();
    /** Recipients waiting out the delay. */
    private readonly waiting = new Map<string, Waiting>();
    /**
     * Recipients whose notification is being delivered right now. Claimed before
     * the callback runs, so a second mention cannot race it into a duplicate.
     *
     * A withdrawal deliberately does **not** clear this. The callback is already
     * running and cannot be recalled, so dropping the claim would let the person
     * be mentioned again mid-flight and notified a second time for the same
     * delivery.
     */
    private readonly delivering = new Set<string>();
    /**
     * Recipients whose notification is out and who are still mentioned. Cleared
     * as soon as nobody mentions them any more, so a later mention is a new
     * lifecycle with a fresh grace period.
     */
    private readonly delivered = new Set<string>();

    constructor(
        onReady: (mention: MentionOccurrence) => Promise<void>,
        delayMs: number = MENTION_GRACE_PERIOD_MS
    ) {
        this.onReady = onReady;
        this.delayMs = delayMs;
    }

    /**
     * Takes the authoritative set of mentions standing in the text.
     *
     * A recipient with no occurrence left is withdrawn at once: a waiting timer
     * is cleared and its promise resolves without a notification, and a delivered
     * claim is forgotten so mentioning that person again starts a fresh cycle.
     */
    public updateWritten(mentions: readonly MentionOccurrence[]): void {
        this.written.clear();
        for (const mention of mentions) {
            const key = normalizeDataverseId(mention.userId);
            if (key.length === 0) {
                continue;
            }
            const forKey = this.written.get(key);
            // Copied, so later edits to the caller's objects cannot reach in here.
            if (forKey === undefined) {
                this.written.set(key, [copyOccurrence(mention)]);
            } else {
                forKey.push(copyOccurrence(mention));
            }
        }

        for (const [key, waiting] of [...this.waiting]) {
            if (!this.written.has(key)) {
                // Run through the path the timer would have taken. The recipient
                // has no occurrence left, so that path clears the timer, drops the
                // entry and resolves without calling the callback — the promise
                // contract is the same whether the wait ran out or was cut short.
                waiting.fire();
            }
        }

        // Only completed deliveries are forgotten here. A delivery in flight keeps
        // its claim: it cannot be recalled, so releasing it would open the door to
        // a duplicate.
        for (const key of [...this.delivered]) {
            if (!this.written.has(key)) {
                this.delivered.delete(key);
            }
        }
    }

    /**
     * Starts the grace period for the person a mention names.
     *
     * Resolves once the notification went out, or once it was dropped because the
     * mention was withdrawn. Rejects only when the notification itself failed.
     * Calling it again for someone already waiting, on the way or notified is a
     * no-op: one person, one notification, however many times they are mentioned.
     */
    public async schedule(mention: MentionOccurrence): Promise<void> {
        const key = normalizeDataverseId(mention.userId);
        // Nobody can be identified from this, so nobody can be told.
        if (
            key.length === 0 ||
            this.waiting.has(key) ||
            this.delivering.has(key) ||
            this.delivered.has(key)
        ) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            let handle: ReturnType<typeof setTimeout> | undefined;

            const fire = (): void => {
                // Harmless whether the timer already fired or not, and whether
                // the entry is still there or not.
                clearTimeout(handle);
                this.waiting.delete(key);

                const current = this.currentOccurrence(key);
                if (current === undefined) {
                    // Withdrawn while waiting: nothing to tell anyone about.
                    resolve();
                    return;
                }

                this.delivering.add(key);
                // A copy: what the callback receives must not be the object this
                // scheduler goes on comparing and delivering from.
                void this.onReady(copyOccurrence(current)).then(
                    () => {
                        this.delivering.delete(key);
                        // Counts only for someone who is mentioned right now. If
                        // the person was removed while the notification was on its
                        // way, nothing is retained and a later mention starts over;
                        // if they were removed and mentioned again, the delivery
                        // that just finished covers that mention.
                        if (this.written.has(key)) {
                            this.delivered.add(key);
                        }
                        resolve();
                    },
                    (error: unknown) => {
                        // Not reached, so the recipient stays eligible for another
                        // attempt. The failure is passed on untouched and never
                        // logged: it is the caller's to describe.
                        this.delivering.delete(key);
                        reject(error);
                    }
                );
            };

            handle = setTimeout(fire, this.delayMs);
            this.waiting.set(key, { fire });
        });
    }

    /**
     * Lets everyone still waiting go now, each still subject to the check the
     * timer would have made, so a recipient who is no longer mentioned is not
     * notified.
     */
    public flushPending(): void {
        for (const waiting of [...this.waiting.values()]) {
            waiting.fire();
        }
    }

    /** The surviving occurrence to describe: the earliest one in the text. */
    private currentOccurrence(key: string): MentionOccurrence | undefined {
        const occurrences = this.written.get(key);
        if (occurrences === undefined || occurrences.length === 0) {
            return undefined;
        }

        return occurrences.reduce((earliest, occurrence) =>
            occurrence.start < earliest.start ? occurrence : earliest
        );
    }

}
