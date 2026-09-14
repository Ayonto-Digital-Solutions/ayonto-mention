import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs } from "../MentionControl/generated/ManifestTypes";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { MENTION_GRACE_PERIOD_MS } from "../src/services/mentionGracePeriod";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";

const RECORD_A = "aaaaaaaa-1111-2222-3333-444444444444";
const RECORD_B = "bbbbbbbb-5555-6666-7777-888888888888";

/** Fictional people. Two of them deliberately share a display name. */
const alex: MentionOccurrence = {
    start: 0,
    name: "Alex Rivera",
    userId: "u-alex",
    email: "alex.rivera@example.invalid",
};
const dana: MentionOccurrence = { start: 20, name: "Dana Winter", userId: "u-dana" };
const robinA: MentionOccurrence = { start: 0, name: "Robin Fox", userId: "id-a" };
const robinB: MentionOccurrence = { start: 30, name: "Robin Fox", userId: "id-b" };

interface CreateCall {
    readonly entity: string;
    readonly data: Record<string, unknown>;
}

interface ReadCall {
    readonly entity: string;
}

interface Host {
    readonly webAPI: ComponentFramework.WebApi;
    readonly creates: CreateCall[];
    readonly reads: ReadCall[];
    readonly searches: string[];
    /** Answers the pending user search with the given people. */
    settleSearch(index: number, users: readonly { id: string; name: string; email?: string }[]): Promise<void>;
    /** Holds the next create open until released. */
    holdNextCreate(): void;
    releaseCreate(): void;
    failNextCreate(reason: Error): void;
}

function makeHost(): Host {
    const creates: CreateCall[] = [];
    const reads: ReadCall[] = [];
    const searches: string[] = [];
    const searchResolvers: ((value: unknown) => void)[] = [];
    let holdCreate = false;
    let releaseHeld: (() => void) | undefined;
    let createFailure: Error | null = null;

    const webAPI = {
        createRecord: jest.fn((entity: string, data: Record<string, unknown>) => {
            creates.push({ entity, data });
            if (createFailure !== null) {
                const reason = createFailure;
                createFailure = null;
                return Promise.reject(reason);
            }
            if (holdCreate) {
                holdCreate = false;
                return new Promise<{ id: string; entityType: string }>((resolve) => {
                    releaseHeld = () => {
                        resolve({ id: "created-1", entityType: entity });
                    };
                });
            }
            return Promise.resolve({ id: "created-1", entityType: entity });
        }),
        retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
            if (entity === "systemuser") {
                searches.push(options ?? "");
                return new Promise((resolve) => searchResolvers.push(resolve));
            }
            reads.push({ entity });
            return Promise.resolve({ entities: [], nextLink: "" });
        }),
    } as unknown as ComponentFramework.WebApi;

    return {
        webAPI,
        creates,
        reads,
        searches,
        settleSearch: async (index, users) => {
            searchResolvers[index]?.({ entities: users.map(toSystemUserRow), nextLink: "" });
            await flush();
        },
        holdNextCreate: () => {
            holdCreate = true;
        },
        releaseCreate: () => {
            releaseHeld?.();
            releaseHeld = undefined;
        },
        failNextCreate: (reason) => {
            createFailure = reason;
        },
    };
}

function toSystemUserRow(user: { id: string; name: string; email?: string }): Record<string, unknown> {
    return {
        systemuserid: user.id,
        fullname: user.name,
        internalemailaddress: user.email ?? null,
        jobtitle: null,
    };
}

interface HostOptions {
    readonly value?: string;
    readonly recordId?: string;
    readonly recordTable?: string;
    readonly logicalName?: string;
    readonly webApi?: ComponentFramework.WebApi;
}

function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    return {
        parameters: {
            field: {
                raw: options.value ?? "",
                attributes: {
                    MaxLength: undefined,
                    LogicalName: options.logicalName ?? "description",
                },
            },
            recordId: { raw: options.recordId ?? RECORD_A },
            recordTable: { raw: options.recordTable ?? "account" },
        },
        mode: { isControlDisabled: false, label: "Comment" },
        webAPI: options.webApi ?? makeHost().webAPI,
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;
let notifyCount = 0;

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function start(options: HostOptions = {}): {
    control: MentionControl;
    editor: MentionEditorProps;
} {
    const control = new MentionControl();
    const context = makeContext(options);
    control.init(
        context,
        () => {
            notifyCount += 1;
        },
        {}
    );
    return { control, editor: render(control, context) };
}

/** Renders and returns the props the adapter handed the editor. */
function render(
    control: MentionControl,
    context: ComponentFramework.Context<IInputs>
): MentionEditorProps {
    let element: React.ReactElement | undefined;
    act(() => {
        element = control.updateView(context);
        ReactDOM.render(element, container);
    });
    if (element === undefined) {
        throw new Error("updateView returned nothing");
    }
    return element.props as MentionEditorProps;
}

function renderKey(
    control: MentionControl,
    context: ComponentFramework.Context<IInputs>
): string {
    let element: React.ReactElement | undefined;
    act(() => {
        element = control.updateView(context);
        ReactDOM.render(element, container);
    });
    return String(element?.key);
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function advance(ms: number): void {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

/** Advances past the grace period and lets the write settle. */
async function passGracePeriod(): Promise<void> {
    advance(MENTION_GRACE_PERIOD_MS);
    await flush();
}

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

function type(next: string, caret: number = next.length): void {
    const element = field();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
    });
}

function press(key: string): void {
    act(() => {
        Simulate.keyDown(field(), { key });
    });
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    notifyCount = 0;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stubbedScrollIntoView(): void {
            // Scrolling is not what these tests are about.
        },
    });
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
    if (originalScrollIntoView === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    } else {
        Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    }
});

describe("MentionControl persistence timing", () => {
    it("writes nothing when the mention is selected", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });

        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        await flush();

        expect(host.creates).toEqual([]);
    });

    it("writes nothing a millisecond before the grace period is up", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(MENTION_GRACE_PERIOD_MS - 1);
        await flush();

        expect(host.creates).toEqual([]);
    });

    it("writes exactly one row once the grace period is up", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        await passGracePeriod();

        expect(host.creates).toHaveLength(1);
    });
});

describe("MentionControl persistence payload", () => {
    it("writes the mention against the record it belongs to", async () => {
        const host = makeHost();
        const { editor } = start({
            webApi: host.webAPI,
            recordId: `{${RECORD_A.toUpperCase()}}`,
            recordTable: "Account",
            logicalName: "Description",
        });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        await passGracePeriod();

        expect(host.creates[0]?.entity).toBe("ayonto_mention");
        expect(host.creates[0]?.data).toEqual({
            ayonto_name: "@Alex Rivera",
            ayonto_recipientuserid: "u-alex",
            ayonto_recipientname: "Alex Rivera",
            ayonto_recipientemail: "alex.rivera@example.invalid",
            ayonto_recordtable: "account",
            ayonto_recordid: RECORD_A,
            ayonto_sourcefield: "description",
        });
    });

    it("leaves the address out when the mention carries none", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([dana]);
        editor.onMentionSelected?.(dana);

        await passGracePeriod();

        expect(host.creates[0]?.data).not.toHaveProperty("ayonto_recipientemail");
        expect(Object.keys(host.creates[0]?.data ?? {})).toHaveLength(6);
    });
});

describe("MentionControl withdrawal and de-duplication", () => {
    it("writes nothing when the mention is removed inside the grace period", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        editor.onWrittenMentionsChange?.([]);

        await passGracePeriod();
        expect(host.creates).toEqual([]);
    });

    it("writes one row for a person mentioned twice", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        const second: MentionOccurrence = { ...alex, start: 40 };

        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        editor.onWrittenMentionsChange?.([alex, second]);
        editor.onMentionSelected?.(second);

        await passGracePeriod();
        expect(host.creates).toHaveLength(1);
    });

    it("writes a row each for two people who share a display name", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });

        editor.onWrittenMentionsChange?.([robinA]);
        editor.onMentionSelected?.(robinA);
        editor.onWrittenMentionsChange?.([robinA, robinB]);
        editor.onMentionSelected?.(robinB);

        await passGracePeriod();

        expect(host.creates).toHaveLength(2);
        expect(host.creates.map((c) => c.data.ayonto_recipientuserid)).toEqual(["id-a", "id-b"]);
    });
});

describe("MentionControl unsaved record", () => {
    it("writes nothing while the record has no id", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI, recordId: "" });

        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        advance(MENTION_GRACE_PERIOD_MS * 3);
        await flush();

        expect(host.creates).toEqual([]);
    });

    it("gives the mention a full grace period once the record is saved", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: "" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        advance(MENTION_GRACE_PERIOD_MS * 2);
        await flush();
        expect(host.creates).toEqual([]);

        // Dataverse saves the record and starts reporting its id.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_A }));

        advance(MENTION_GRACE_PERIOD_MS - 1);
        await flush();
        expect(host.creates).toEqual([]);

        advance(1);
        await flush();
        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.data.ayonto_recordid).toBe(RECORD_A);
    });

    it("never writes a mention that was removed before the record was saved", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: "" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        editor.onWrittenMentionsChange?.([]);

        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_A }));
        advance(MENTION_GRACE_PERIOD_MS * 2);
        await flush();

        expect(host.creates).toEqual([]);
    });

    it("does not remount the editor when the record is first saved", () => {
        const host = makeHost();
        const control = new MentionControl();
        const first = makeContext({ webApi: host.webAPI, recordId: "" });
        control.init(first, () => undefined, {});

        const before = renderKey(control, first);
        const after = renderKey(control, makeContext({ webApi: host.webAPI, recordId: RECORD_A }));

        // Same editing session: the identities picked while unsaved must survive.
        expect(after).toBe(before);
    });
});

describe("MentionControl record boundaries", () => {
    it("never writes a pending mention from one record onto another", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: RECORD_A });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B }));

        await passGracePeriod();
        expect(host.creates).toEqual([]);
    });

    it("writes a new mention on the record that is open now", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: RECORD_A });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        advance(2000);

        const onB = render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B }));
        onB.onWrittenMentionsChange?.([dana]);
        onB.onMentionSelected?.(dana);
        await passGracePeriod();

        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.data.ayonto_recordid).toBe(RECORD_B);
        expect(host.creates[0]?.data.ayonto_recipientuserid).toBe("u-dana");
    });

    it("treats a changed table as a record boundary", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordTable: "account" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        render(control, makeContext({ webApi: host.webAPI, recordTable: "contact" }));
        await passGracePeriod();

        expect(host.creates).toEqual([]);
    });

    it("treats a changed column as a record boundary", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, logicalName: "description" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        render(control, makeContext({ webApi: host.webAPI, logicalName: "ayonto_comment" }));
        await passGracePeriod();

        expect(host.creates).toEqual([]);
    });

    it("treats losing the record context as a boundary", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: RECORD_A });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        render(control, makeContext({ webApi: host.webAPI, recordId: "" }));
        await passGracePeriod();

        expect(host.creates).toEqual([]);
    });

    it("remounts the editor when the record changes", () => {
        const host = makeHost();
        const control = new MentionControl();
        const onA = makeContext({ webApi: host.webAPI, recordId: RECORD_A });
        control.init(onA, () => undefined, {});

        const keyA = renderKey(control, onA);
        const keyB = renderKey(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B }));

        expect(keyB).not.toBe(keyA);
    });

    it("lets a write already in flight finish against the record it started on", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: RECORD_A });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        host.holdNextCreate();
        await passGracePeriod();
        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.data.ayonto_recordid).toBe(RECORD_A);

        // The form moves on while that write is still open.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B }));
        host.releaseCreate();
        await flush();

        // It finished against A, and nothing followed it onto B.
        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.data.ayonto_recordid).toBe(RECORD_A);
    });
});

describe("MentionControl failure and lifecycle", () => {
    it("swallows a failed write without logging it or notifying the framework", async () => {
        const errors: unknown[][] = [];
        const warnings: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
            errors.push(a);
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
            warnings.push(a);
        });

        try {
            const host = makeHost();
            const { editor } = start({ webApi: host.webAPI });
            host.failNextCreate(new Error("Access denied at org-a1b2c3.example.invalid"));
            editor.onWrittenMentionsChange?.([alex]);
            editor.onMentionSelected?.(alex);

            await passGracePeriod();

            expect(host.creates).toHaveLength(1);
            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
            expect(notifyCount).toBe(0);

            // Still eligible: selecting again schedules a fresh attempt.
            editor.onMentionSelected?.(alex);
            await passGracePeriod();
            expect(host.creates).toHaveLength(2);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it("writes nothing after the control is destroyed", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        advance(2000);
        control.destroy();

        await passGracePeriod();
        expect(host.creates).toEqual([]);
    });

    it("can be destroyed on a record that never became persistable", () => {
        // A new-record form the user abandons before Dataverse ever saves it:
        // no scope was ever opened, so there is nothing to tear down.
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: "" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);

        expect(() => {
            control.destroy();
        }).not.toThrow();
        expect(host.creates).toEqual([]);
    });

    it("never reads the mention table", async () => {
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        await passGracePeriod();

        expect(host.reads).toEqual([]);
        expect(host.creates).toHaveLength(1);
    });
});

describe("MentionControl end to end through the rendered editor", () => {
    it("persists a suggestion picked in the real editor, only after the grace period", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, recordId: RECORD_A });

        // Typed into the real textarea, answered by the real user search.
        type("@Da");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await host.settleSearch(0, [
            { id: "u-dana", name: "Dana Winter", email: "dana.winter@example.invalid" },
        ]);
        expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

        press("Enter");
        expect(field().value).toBe("@Dana Winter ");

        // Picking it writes nothing yet.
        advance(MENTION_GRACE_PERIOD_MS - 1);
        await flush();
        expect(host.creates).toEqual([]);

        advance(1);
        await flush();

        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.entity).toBe("ayonto_mention");
        expect(host.creates[0]?.data).toEqual({
            ayonto_name: "@Dana Winter",
            ayonto_recipientuserid: "u-dana",
            ayonto_recipientname: "Dana Winter",
            ayonto_recipientemail: "dana.winter@example.invalid",
            ayonto_recordtable: "account",
            ayonto_recordid: RECORD_A,
            ayonto_sourcefield: "description",
        });
    });
});

describe("MentionControl reconciliation across record boundaries", () => {
    it("takes the new record's value even when it equals the old record's baseline", () => {
        const host = makeHost();
        const { control } = start({ webApi: host.webAPI, recordId: RECORD_A, value: "A" });
        expect(field().value).toBe("A");

        // Edited on A and not acknowledged: "A" is still A's baseline.
        type("AB");
        expect(control.getOutputs()).toEqual({ field: "AB" });
        const notifiedAfterEdit = notifyCount;

        // B's own value happens to read the same as A's baseline.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B, value: "A" }));

        expect(field().value).toBe("A");
        expect(control.getOutputs()).toEqual({ field: "A" });
        // Changing records is not an edit.
        expect(notifyCount).toBe(notifiedAfterEdit);
    });

    it("takes the new record's value even when it equals an earlier output on the old record", () => {
        const host = makeHost();
        const { control } = start({ webApi: host.webAPI, recordId: RECORD_A, value: "A" });
        type("AB");
        type("ABC");
        expect(control.getOutputs()).toEqual({ field: "ABC" });

        // B really holds "AB", which is also something A emitted.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B, value: "AB" }));

        expect(field().value).toBe("AB");
        expect(control.getOutputs()).toEqual({ field: "AB" });
    });

    it("closes the old lineage, so a later host value from it applies normally", () => {
        const host = makeHost();
        const { control } = start({ webApi: host.webAPI, recordId: RECORD_A, value: "A" });
        type("AB");
        type("ABC");
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B, value: "AB" }));

        // "ABC" was A's last output; on B it is just a host value.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B, value: "ABC" }));
        expect(field().value).toBe("ABC");
        expect(control.getOutputs()).toEqual({ field: "ABC" });

        // And so is "A", the value A's cycle started from.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_B, value: "A" }));
        expect(field().value).toBe("A");
        expect(control.getOutputs()).toEqual({ field: "A" });
    });

    it("keeps the local edit when an unsaved record receives its first id", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: "", value: "A" });
        editor.onWrittenMentionsChange?.([alex]);
        editor.onMentionSelected?.(alex);
        type("AB");
        expect(control.getOutputs()).toEqual({ field: "AB" });

        // The record is saved while the host still echoes the pre-edit value.
        // This is the same editing session, not a new record.
        render(control, makeContext({ webApi: host.webAPI, recordId: RECORD_A, value: "A" }));

        expect(field().value).toBe("AB");
        expect(control.getOutputs()).toEqual({ field: "AB" });

        // The mention picked while unsaved still gets persisted, on a fresh window.
        advance(MENTION_GRACE_PERIOD_MS - 1);
        await flush();
        expect(host.creates).toEqual([]);
        advance(1);
        await flush();
        expect(host.creates).toHaveLength(1);
        expect(host.creates[0]?.data.ayonto_recordid).toBe(RECORD_A);
    });
});
