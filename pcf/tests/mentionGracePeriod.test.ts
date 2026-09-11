import {
    MENTION_GRACE_PERIOD_MS,
    MentionGracePeriod,
} from "../src/services/mentionGracePeriod";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";

/** Fictional people. Two of them deliberately share a display name. */
const alex = (over: Partial<MentionOccurrence> = {}): MentionOccurrence => ({
    start: 0,
    name: "Alex Rivera",
    userId: "u-alex",
    ...over,
});
const dana = (over: Partial<MentionOccurrence> = {}): MentionOccurrence => ({
    start: 20,
    name: "Dana Winter",
    userId: "u-dana",
    ...over,
});
const robinA = (over: Partial<MentionOccurrence> = {}): MentionOccurrence => ({
    start: 0,
    name: "Robin Fox",
    userId: "id-a",
    ...over,
});
const robinB = (over: Partial<MentionOccurrence> = {}): MentionOccurrence => ({
    start: 30,
    name: "Robin Fox",
    userId: "id-b",
    ...over,
});

interface Harness {
    readonly grace: MentionGracePeriod;
    readonly delivered: MentionOccurrence[];
    failNext(reason: Error): void;
}

function makeHarness(delayMs?: number): Harness {
    const delivered: MentionOccurrence[] = [];
    let failure: Error | null = null;

    const onReady = (mention: MentionOccurrence): Promise<void> => {
        if (failure !== null) {
            const reason = failure;
            failure = null;
            return Promise.reject(reason);
        }
        delivered.push(mention);
        return Promise.resolve();
    };

    return {
        delivered,
        grace:
            delayMs === undefined
                ? new MentionGracePeriod(onReady)
                : new MentionGracePeriod(onReady, delayMs),
        failNext: (reason) => {
            failure = reason;
        },
    };
}

interface HeldHarness {
    readonly grace: MentionGracePeriod;
    /** Occurrences the callback was handed, in order. */
    readonly started: MentionOccurrence[];
    /** Lets the delivery that is currently in flight finish. */
    release(): void;
}

/** A grace period whose delivery stays in flight until the test releases it. */
function makeHeldHarness(delayMs: number, onCalled?: (m: MentionOccurrence) => void): HeldHarness {
    const started: MentionOccurrence[] = [];
    let finish: (() => void) | undefined;

    return {
        started,
        grace: new MentionGracePeriod((mention) => {
            started.push(mention);
            onCalled?.(mention);
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        }, delayMs),
        release: () => {
            finish?.();
            finish = undefined;
        },
    };
}

function advance(ms: number): void {
    jest.advanceTimersByTime(ms);
}

/** Lets the promise continuations behind a fired timer run. */
async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe("MentionGracePeriod timing", () => {
    it("waits exactly five seconds by default", async () => {
        const harness = makeHarness();
        harness.grace.updateWritten([alex()]);
        const pending = harness.grace.schedule(alex());

        advance(MENTION_GRACE_PERIOD_MS - 1);
        await settle();
        expect(harness.delivered).toEqual([]);

        advance(1);
        await pending;
        expect(harness.delivered).toEqual([alex()]);
    });

    it("declares the grace period as five seconds", () => {
        expect(MENTION_GRACE_PERIOD_MS).toBe(5000);
    });

    it("gives each recipient a timer of their own", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex(), dana()]);
        const first = harness.grace.schedule(alex());
        advance(400);
        const second = harness.grace.schedule(dana());

        advance(600);
        await first;
        expect(harness.delivered.map((m) => m.userId)).toEqual(["u-alex"]);

        advance(400);
        await second;
        expect(harness.delivered.map((m) => m.userId)).toEqual(["u-alex", "u-dana"]);
    });
});

describe("MentionGracePeriod recipient identity", () => {
    it("keeps two people with the same display name apart", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([robinA(), robinB()]);

        const first = harness.grace.schedule(robinA());
        const second = harness.grace.schedule(robinB());
        advance(1000);
        await Promise.all([first, second]);

        expect(harness.delivered.map((m) => m.userId)).toEqual(["id-a", "id-b"]);
    });

    it("treats brace and case variants of one id as the same person", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex()]);

        const first = harness.grace.schedule(alex({ userId: "  {U-ALEX}  " }));
        const second = harness.grace.schedule(alex({ userId: "U-Alex" }));
        advance(1000);
        await Promise.all([first, second]);

        expect(harness.delivered).toHaveLength(1);
    });

    it("notifies once for a person mentioned twice", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex({ start: 0 }), alex({ start: 40 })]);

        const first = harness.grace.schedule(alex({ start: 0 }));
        const second = harness.grace.schedule(alex({ start: 40 }));
        advance(1000);
        await Promise.all([first, second]);

        expect(harness.delivered).toHaveLength(1);
    });

    it("ignores a mention nobody can be identified from", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex({ userId: "   " })]);

        await harness.grace.schedule(alex({ userId: "   " }));
        advance(1000);
        await settle();

        expect(harness.delivered).toEqual([]);
    });
});

describe("MentionGracePeriod withdrawal", () => {
    it("cancels the wait the moment the last occurrence goes", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex()]);
        const pending = harness.grace.schedule(alex());

        advance(400);
        harness.grace.updateWritten([]);
        await pending;

        advance(1000);
        await settle();
        expect(harness.delivered).toEqual([]);
    });

    it("keeps waiting while another occurrence of the same person remains", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex({ start: 0 }), alex({ start: 40 })]);
        const pending = harness.grace.schedule(alex({ start: 0 }));

        // Only one of the two goes.
        advance(400);
        harness.grace.updateWritten([alex({ start: 40 })]);

        advance(600);
        await pending;
        expect(harness.delivered).toHaveLength(1);
    });

    it("gives a re-mention the full delay again", async () => {
        // t=0 schedule, t=2 withdrawn, t=4 mentioned again: the old clock must
        // not deliver at t=5, and the new one must deliver at t=9.
        const harness = makeHarness();
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());

        advance(2000);
        harness.grace.updateWritten([]);
        await first;

        advance(2000);
        harness.grace.updateWritten([alex()]);
        const second = harness.grace.schedule(alex());

        // t=5 on the original clock.
        advance(1000);
        await settle();
        expect(harness.delivered).toEqual([]);

        // t=9: five full seconds after the second mention.
        advance(4000);
        await second;
        expect(harness.delivered).toHaveLength(1);
    });
});

describe("MentionGracePeriod payload", () => {
    it("describes a surviving occurrence when the scheduled one is gone", async () => {
        const harness = makeHarness(1000);
        const first = alex({ start: 0, email: "first@example.invalid" });
        const second = alex({ start: 40, email: "second@example.invalid" });
        harness.grace.updateWritten([first, second]);
        const pending = harness.grace.schedule(first);

        // The occurrence that was picked is deleted; another one remains.
        advance(400);
        harness.grace.updateWritten([second]);

        advance(600);
        await pending;

        expect(harness.delivered).toEqual([second]);
        expect(harness.delivered[0]?.email).toBe("second@example.invalid");
    });

    it("uses the address the surviving occurrence carries, not the scheduled one", async () => {
        const harness = makeHarness(1000);
        const scheduled = alex({ start: 0, email: "stale@example.invalid" });
        harness.grace.updateWritten([scheduled]);
        const pending = harness.grace.schedule(scheduled);

        advance(400);
        harness.grace.updateWritten([alex({ start: 0, email: "current@example.invalid" })]);

        advance(600);
        await pending;

        expect(harness.delivered[0]?.email).toBe("current@example.invalid");
    });

    it("picks the earliest occurrence when several survive", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex({ start: 80 })]);
        const pending = harness.grace.schedule(alex({ start: 80 }));

        advance(400);
        harness.grace.updateWritten([
            alex({ start: 80, email: "late@example.invalid" }),
            alex({ start: 5, email: "early@example.invalid" }),
            alex({ start: 40, email: "middle@example.invalid" }),
        ]);

        advance(600);
        await pending;

        expect(harness.delivered[0]?.start).toBe(5);
        expect(harness.delivered[0]?.email).toBe("early@example.invalid");
    });

    it("follows a position that moved while waiting", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex({ start: 0 })]);
        const pending = harness.grace.schedule(alex({ start: 0 }));

        advance(400);
        harness.grace.updateWritten([alex({ start: 12 })]);

        advance(600);
        await pending;

        expect(harness.delivered[0]?.start).toBe(12);
    });
});

describe("MentionGracePeriod delivered recipients", () => {
    it("does not notify again while the person is still mentioned", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());
        advance(1000);
        await first;

        harness.grace.updateWritten([alex({ start: 0 }), alex({ start: 40 })]);
        await harness.grace.schedule(alex({ start: 40 }));
        advance(1000);
        await settle();

        expect(harness.delivered).toHaveLength(1);
    });

    it("forgets a delivered recipient once nobody mentions them", async () => {
        const harness = makeHarness(1000);
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());
        advance(1000);
        await first;

        harness.grace.updateWritten([]);
        harness.grace.updateWritten([alex()]);
        const second = harness.grace.schedule(alex());
        advance(1000);
        await second;

        expect(harness.delivered).toHaveLength(2);
    });
});

describe("MentionGracePeriod delivery failure", () => {
    it("passes the failure on and leaves the recipient eligible", async () => {
        const harness = makeHarness(1000);
        const reason = new Error("Delivery refused");
        harness.grace.updateWritten([alex()]);
        harness.failNext(reason);

        const failing = harness.grace.schedule(alex());
        advance(1000);
        await expect(failing).rejects.toBe(reason);

        // The claim is gone, so the recipient can be scheduled again.
        const retry = harness.grace.schedule(alex());
        advance(1000);
        await retry;
        expect(harness.delivered).toHaveLength(1);
    });

    it("does not log the failure", async () => {
        const errors: unknown[][] = [];
        const warnings: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
            errors.push(a);
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
            warnings.push(a);
        });

        try {
            const harness = makeHarness(1000);
            harness.grace.updateWritten([alex()]);
            harness.failNext(new Error("Delivery refused at org-a1b2c3.example.invalid"));
            const failing = harness.grace.schedule(alex());
            advance(1000);
            await expect(failing).rejects.toThrow();

            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });
});

describe("MentionGracePeriod flushPending", () => {
    it("lets everyone still waiting go at once", async () => {
        const harness = makeHarness();
        harness.grace.updateWritten([alex(), dana()]);
        const first = harness.grace.schedule(alex());
        const second = harness.grace.schedule(dana());

        harness.grace.flushPending();
        await Promise.all([first, second]);

        expect(harness.delivered.map((m) => m.userId)).toEqual(["u-alex", "u-dana"]);
    });

    it("still leaves out someone who is no longer mentioned", async () => {
        const harness = makeHarness();
        harness.grace.updateWritten([alex(), dana()]);
        const first = harness.grace.schedule(alex());
        const second = harness.grace.schedule(dana());

        // Alex is withdrawn, which already cancels that wait.
        harness.grace.updateWritten([dana()]);
        harness.grace.flushPending();
        await Promise.all([first, second]);

        expect(harness.delivered.map((m) => m.userId)).toEqual(["u-dana"]);
    });

    it("leaves nothing waiting behind", async () => {
        const harness = makeHarness();
        harness.grace.updateWritten([alex()]);
        const pending = harness.grace.schedule(alex());

        harness.grace.flushPending();
        await pending;
        advance(MENTION_GRACE_PERIOD_MS);
        await settle();

        expect(harness.delivered).toHaveLength(1);
    });
});

describe("MentionGracePeriod isolation", () => {
    it("cannot be reached through the snapshot it was given", async () => {
        const harness = makeHarness(1000);
        const occurrences = [alex({ start: 0, email: "kept@example.invalid" })];
        harness.grace.updateWritten(occurrences);
        const pending = harness.grace.schedule(alex());

        // Ordinary JavaScript writing through a readonly type.
        (occurrences[0] as { start: number }).start = 999;
        (occurrences[0] as { email: string }).email = "tampered@example.invalid";
        occurrences.length = 0;

        advance(1000);
        await pending;

        expect(harness.delivered).toEqual([alex({ start: 0, email: "kept@example.invalid" })]);
    });
});

describe("MentionGracePeriod delivery in flight", () => {
    it("does not let a withdrawal mid-delivery open the door to a second one", async () => {
        const harness = makeHeldHarness(1000);
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());

        // The timer fires and the delivery starts, but has not finished.
        advance(1000);
        await settle();
        expect(harness.started).toHaveLength(1);

        // The person is removed and mentioned again while that delivery is still
        // on its way. The claim cannot be released: the callback is already out.
        harness.grace.updateWritten([]);
        harness.grace.updateWritten([alex()]);
        await harness.grace.schedule(alex());
        advance(1000);
        await settle();

        expect(harness.started).toHaveLength(1);

        // Finishing successfully counts for the mention that is there now.
        harness.release();
        await first;
        await harness.grace.schedule(alex());
        advance(1000);
        await settle();
        expect(harness.started).toHaveLength(1);
    });

    it("starts a new lifecycle once the delivered recipient is gone again", async () => {
        const harness = makeHeldHarness(1000);
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());
        advance(1000);
        await settle();
        harness.release();
        await first;

        // Removed after the delivery succeeded, then mentioned again later.
        harness.grace.updateWritten([]);
        harness.grace.updateWritten([alex()]);
        const second = harness.grace.schedule(alex());
        advance(1000);
        await settle();
        harness.release();
        await second;

        expect(harness.started).toHaveLength(2);
    });

    it("retains nothing when the recipient is gone as the delivery succeeds", async () => {
        const harness = makeHeldHarness(1000);
        harness.grace.updateWritten([alex()]);
        const first = harness.grace.schedule(alex());
        advance(1000);
        await settle();

        // Removed while in flight, and still absent when it finishes.
        harness.grace.updateWritten([]);
        harness.release();
        await first;

        // A later mention is a fresh lifecycle.
        harness.grace.updateWritten([alex()]);
        const second = harness.grace.schedule(alex());
        advance(1000);
        await settle();
        harness.release();
        await second;

        expect(harness.started).toHaveLength(2);
    });

    it("hands the callback a copy it cannot write back through", async () => {
        const original = alex({ start: 7, name: "Alex Rivera", email: "kept@example.invalid" });
        // What each delivery actually presented, recorded before it is tampered
        // with — asserting on the tampered object itself would prove nothing.
        const presented: MentionOccurrence[] = [];
        let attempt = 0;

        const grace = new MentionGracePeriod((mention) => {
            presented.push({ ...mention });
            // Ordinary JavaScript writing through a readonly type.
            (mention as { start: number }).start = 999;
            (mention as { userId: string }).userId = "someone-else";
            (mention as { name: string }).name = "Tampered";
            (mention as { email: string }).email = "tampered@example.invalid";

            attempt += 1;
            // The first attempt fails, which leaves the recipient eligible and —
            // crucially — leaves the scheduler's own stored occurrence in place.
            // Nothing refreshes it from the caller in between, so a second
            // delivery can only present clean values if the callback was handed a
            // copy.
            return attempt === 1 ? Promise.reject(new Error("Refused")) : Promise.resolve();
        }, 1000);

        grace.updateWritten([original]);
        const failing = grace.schedule(original);
        advance(1000);
        await expect(failing).rejects.toThrow("Refused");

        const retry = grace.schedule(original);
        advance(1000);
        await retry;

        expect(presented).toHaveLength(2);
        expect(presented[1]).toEqual({
            start: 7,
            name: "Alex Rivera",
            userId: "u-alex",
            email: "kept@example.invalid",
        });
    });
});
