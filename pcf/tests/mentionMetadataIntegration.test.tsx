import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs, IOutputs } from "../MentionControl/generated/ManifestTypes";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import { resourceValue } from "./support/resources";

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

interface Payload {
    readonly schemaVersion: number;
    readonly sourceField: string;
    readonly mentions: readonly {
        readonly eventId: string;
        readonly recipientUserId: string;
        readonly occurrences: readonly { readonly start: number; readonly length: number }[];
    }[];
}

interface Host {
    readonly webAPI: ComponentFramework.WebApi;
    /** Every write the control attempted. It must always stay empty. */
    readonly writes: string[];
    readonly searches: string[];
    settleSearch(index: number, users: readonly { id: string; name: string; email?: string }[]): Promise<void>;
}

function makeHost(): Host {
    const writes: string[] = [];
    const searches: string[] = [];
    const searchResolvers: ((value: unknown) => void)[] = [];

    const webAPI = {
        createRecord: jest.fn((entity: string) => {
            writes.push(entity);
            return Promise.resolve({ id: "created-1", entityType: entity });
        }),
        updateRecord: jest.fn((entity: string) => {
            writes.push(entity);
            return Promise.resolve({ id: "updated-1", entityType: entity });
        }),
        deleteRecord: jest.fn((entity: string) => {
            writes.push(entity);
            return Promise.resolve({ id: "deleted-1", entityType: entity });
        }),
        retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
            searches.push(`${entity} ${options ?? ""}`);
            return new Promise((resolve) => searchResolvers.push(resolve));
        }),
    } as unknown as ComponentFramework.WebApi;

    return {
        webAPI,
        writes,
        searches,
        settleSearch: async (index, users) => {
            searchResolvers[index]?.({
                entities: users.map((user) => ({
                    systemuserid: user.id,
                    fullname: user.name,
                    internalemailaddress: user.email ?? null,
                    jobtitle: null,
                })),
                nextLink: "",
            });
            await flush();
        },
    };
}

interface HostOptions {
    readonly value?: string;
    readonly metadata?: string | null;
    readonly metadataEditable?: boolean;
    /** The host reports the client as offline. */
    readonly offline?: boolean;
    /** The host reports no network. */
    readonly networkAvailable?: boolean;
    /** The host says the bound column may not be read. */
    readonly readable?: boolean;
    /** The column's maximum length, when the host reports one. */
    readonly maxLength?: number;
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
                    MaxLength: options.maxLength,
                    LogicalName: options.logicalName ?? "description",
                },
                security:
                    options.readable === undefined
                        ? undefined
                        : { editable: true, readable: options.readable, secured: false },
            },
            recordId: { raw: options.recordId ?? RECORD_A },
            recordTable: { raw: options.recordTable ?? "account" },
            mentionMetadata: {
                // A host may report nothing at all, which is not the same as "".
                raw: options.metadata === undefined ? "" : options.metadata,
                security:
                    options.metadataEditable === undefined
                        ? undefined
                        : { editable: options.metadataEditable, readable: true, secured: false },
            },
        },
        mode: { isControlDisabled: false, label: "Comment" },
        client: {
            disableScroll: false,
            getClient: () => "Web",
            getFormFactor: () => 1,
            isOffline: () => options.offline === true,
            isNetworkAvailable: () => options.networkAvailable !== false,
        },
        resources: { getString: (id: string) => resourceValue(id) },
        formatting: { formatInteger: (value: number) => value.toString() },
        webAPI: options.webApi ?? makeHost().webAPI,
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;
/** What `getOutputs` reported at the instant the framework was told, each time. */
let notified: IOutputs[] = [];

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
            // Read at the moment of the call on purpose: the contract is that
            // both outputs already describe one state when the host is told.
            notified.push(control.getOutputs());
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

/** The payload the control reports right now. */
function payload(control: MentionControl): Payload {
    return JSON.parse(control.getOutputs().mentionMetadata ?? "") as Payload;
}

function eventIds(control: MentionControl): readonly string[] {
    return payload(control).mentions.map((mention) => mention.eventId);
}

/** Hands the adapter one local edit, the way the editor does. */
function edit(
    editor: MentionEditorProps,
    text: string,
    mentions: readonly MentionOccurrence[]
): void {
    editor.onLocalEdit({ text, mentions });
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    notified = [];
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

describe("MentionControl text and metadata as one state", () => {
    it("has both outputs ready at the instant it tells the host about a pick", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, recordId: RECORD_A });

        // Typed into the real textarea, answered by the real user search.
        type("@Da");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await host.settleSearch(0, [
            { id: "u-dana", name: "Dana Winter", email: "dana.winter@example.invalid" },
        ]);
        const before = notified.length;

        press("Enter");

        expect(notified).toHaveLength(before + 1);
        const output = notified[notified.length - 1];
        expect(output?.field).toBe("@Dana Winter ");
        const written = JSON.parse(output?.mentionMetadata ?? "") as Payload;
        expect(written.mentions).toHaveLength(1);
        expect(written.mentions[0]?.recipientUserId).toBe("u-dana");
        // The suggestion carried a name and an address. Neither is written out:
        // the notification is addressed from `systemuser`, where it can be
        // trusted, not from a column anyone who may type here can write.
        expect(Object.keys(written.mentions[0] ?? {}).sort()).toEqual([
            "eventId",
            "occurrences",
            "recipientUserId",
        ]);
        // Where the mention stands, and nothing about who stands there.
        expect(written.mentions[0]?.occurrences).toEqual([{ start: 0, length: 12 }]);
        expect(output?.mentionMetadata).not.toContain("Dana Winter");
        expect(output?.mentionMetadata).not.toContain("dana.winter@example.invalid");
    });

    it("writes nothing about a person even when the mention carries it", () => {
        const { control, editor } = start();

        edit(editor, "@Alex Rivera ", [
            { start: 0, name: "Alex Rivera", userId: "u-alex", email: "alex.rivera@example.invalid" },
        ]);

        const written = control.getOutputs().mentionMetadata ?? "";
        expect(written).not.toContain("Alex Rivera");
        expect(written).not.toContain("alex.rivera@example.invalid");

        const parsed = JSON.parse(written) as Payload;
        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.sourceField).toBe("description");
        expect(parsed.mentions).toHaveLength(1);
        expect(Object.keys(parsed.mentions[0] ?? {}).sort()).toEqual([
            "eventId",
            "occurrences",
            "recipientUserId",
        ]);
        expect(parsed.mentions[0]?.recipientUserId).toBe("u-alex");
    });

    it("keeps the identity when only the name or address changes", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera ", [alex]);
        const before = JSON.parse(control.getOutputs().mentionMetadata ?? "") as Payload;

        // Same person, same episode, written differently.
        edit(editor, "@A. Rivera ", [
            { start: 0, name: "A. Rivera", userId: "u-alex", email: "somewhere.else@example.invalid" },
        ]);

        const after = JSON.parse(control.getOutputs().mentionMetadata ?? "") as Payload;
        expect(after.mentions[0]?.eventId).toBe(before.mentions[0]?.eventId);
        expect(after.mentions[0]?.recipientUserId).toBe("u-alex");
        // Only the span follows the text; nothing about the person is written.
        expect(after.mentions[0]?.occurrences).toEqual([{ start: 0, length: 10 }]);
        expect(control.getOutputs().mentionMetadata).not.toContain("Rivera");
    });

    it("tells the host once for one local edit", () => {
        const { editor } = start();
        notified = [];

        edit(editor, "@Alex Rivera ", [alex]);

        expect(notified).toHaveLength(1);
    });

    it("has the mention gone from both halves when it is deleted", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera ", [alex]);
        notified = [];

        edit(editor, "", []);

        expect(notified).toHaveLength(1);
        expect(notified[0]?.field).toBe("");
        expect(JSON.parse(notified[0]?.mentionMetadata ?? "")).toEqual({
            schemaVersion: 1,
            sourceField: "description",
            mentions: [],
        });
        expect(payload(control).mentions).toEqual([]);
    });

    it("waits for nothing between the edit and the payload", () => {
        const { control, editor } = start();

        edit(editor, "@Alex Rivera ", [alex]);

        // No timer is advanced anywhere in this test.
        expect(payload(control).mentions).toHaveLength(1);
        const immediately = control.getOutputs().mentionMetadata;
        advance(60_000);
        expect(control.getOutputs().mentionMetadata).toBe(immediately);
        expect(notified).toHaveLength(1);
    });

    it("copes with a host that reports no companion value at all", () => {
        const { control, editor } = start({ metadata: null });

        expect(control.getOutputs().mentionMetadata).toBe("");

        render(control, makeContext({ metadata: null, value: "" }));
        edit(editor, "@Alex Rivera ", [alex]);

        expect(payload(control).mentions).toHaveLength(1);
    });

    it("names the column the mentions were written in", () => {
        const { control, editor } = start({ logicalName: "AYONTO_Notes" });

        edit(editor, "@Alex Rivera ", [alex]);

        expect(payload(control).sourceField).toBe("ayonto_notes");
    });
});

describe("MentionControl writes nothing itself", () => {
    it("never writes to Dataverse for a mention", async () => {
        const host = makeHost();
        const { control, editor } = start({ webApi: host.webAPI, recordId: RECORD_A });

        edit(editor, "@Alex Rivera ", [alex]);
        advance(60_000);
        await flush();
        control.destroy();
        advance(60_000);
        await flush();

        expect(host.writes).toEqual([]);
    });

    it("still looks people up through the Web API", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });

        type("@Da");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(host.searches).toHaveLength(1);
        expect(host.searches[0]).toContain("systemuser");
        expect(host.writes).toEqual([]);
    });
});

describe("MentionControl on a record that is not saved yet", () => {
    it("carries a mention picked before the record has an id", () => {
        const { control, editor } = start({ recordId: "" });

        edit(editor, "@Alex Rivera ", [alex]);

        expect(control.getOutputs().field).toBe("@Alex Rivera ");
        expect(payload(control).mentions).toHaveLength(1);
    });

    it("keeps the identifier it gave before the first save", () => {
        const { control, editor } = start({ recordId: "" });
        edit(editor, "@Alex Rivera ", [alex]);
        const before = eventIds(control);

        // Dataverse has saved the record and the id appears.
        render(control, makeContext({ recordId: RECORD_A, value: "@Alex Rivera " }));

        expect(eventIds(control)).toEqual(before);
        expect(payload(control).mentions).toHaveLength(1);
    });

    it("does not remount the editor when the record is first saved", () => {
        const control = new MentionControl();
        const context = makeContext({ recordId: "" });
        control.init(context, () => undefined, {});
        const before = renderKey(control, context);

        const after = renderKey(control, makeContext({ recordId: RECORD_A }));

        expect(after).toBe(before);
    });
});

describe("MentionControl notification episodes", () => {
    it("counts one person mentioned twice as one notification", () => {
        const { control, editor } = start();

        edit(editor, "@Alex Rivera and @Alex Rivera ", [alex, { ...alex, start: 17 }]);

        expect(payload(control).mentions).toHaveLength(1);
    });

    it("keeps the identifier while the mention only moves", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera ", [alex]);
        const before = eventIds(control);

        edit(editor, "Hi @Alex Rivera ", [{ ...alex, start: 3 }]);

        expect(eventIds(control)).toEqual(before);
    });

    it("keeps the identifier while one of two occurrences survives", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera and @Alex Rivera ", [alex, { ...alex, start: 17 }]);
        const before = eventIds(control);

        edit(editor, "@Alex Rivera ", [alex]);

        expect(eventIds(control)).toEqual(before);
    });

    it("ends the notification when the last occurrence goes", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera ", [alex]);

        edit(editor, "gone", []);

        expect(payload(control).mentions).toEqual([]);
    });

    it("starts a new notification when the person is mentioned again", () => {
        const { control, editor } = start();
        edit(editor, "@Alex Rivera ", [alex]);
        const first = eventIds(control);
        edit(editor, "", []);

        edit(editor, "@Alex Rivera ", [alex]);

        expect(eventIds(control)).not.toEqual(first);
        expect(eventIds(control)).toHaveLength(1);
    });

    it("keeps two people who share a display name apart", () => {
        const { control, editor } = start();

        edit(editor, "@Robin Fox and @Robin Fox ", [robinA, robinB]);

        const written = payload(control).mentions;
        expect(written.map((mention) => mention.recipientUserId)).toEqual(["id-a", "id-b"]);
        expect(new Set(written.map((mention) => mention.eventId)).size).toBe(2);
    });

    it("notifies nobody for a name that was only typed", () => {
        const { control, editor } = start();

        // The editor tracks no mention, because nobody was picked.
        edit(editor, "Hi @Alex Rivera, thanks", []);

        expect(payload(control).mentions).toEqual([]);
    });
});

describe("MentionControl record boundaries", () => {
    it("forgets the notifications of the record it leaves", () => {
        const { control, editor } = start({ recordId: RECORD_A });
        edit(editor, "@Alex Rivera ", [alex]);
        const onA = eventIds(control);

        const next = render(control, makeContext({ recordId: RECORD_B, value: "" }));
        edit(next, "@Alex Rivera ", [alex]);

        expect(eventIds(control)).toHaveLength(1);
        expect(eventIds(control)).not.toEqual(onA);
    });

    it("takes the payload the new record brings and reports it back unchanged", () => {
        const stored = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control, editor } = start({ recordId: RECORD_A });
        edit(editor, "@Alex Rivera ", [alex]);

        render(control, makeContext({ recordId: RECORD_B, value: "", metadata: stored }));

        expect(control.getOutputs().mentionMetadata).toBe(stored);
    });

    it("treats losing the record context as a boundary", () => {
        const { control, editor } = start({ recordId: RECORD_A });
        edit(editor, "@Alex Rivera ", [alex]);
        const before = eventIds(control);

        // The form reports no record any more: nothing of this one may follow.
        const next = render(control, makeContext({ recordId: "", value: "" }));
        edit(next, "@Alex Rivera ", [alex]);

        expect(eventIds(control)).not.toEqual(before);
    });

    it("remounts the editor when the record changes", () => {
        const control = new MentionControl();
        const context = makeContext({ recordId: RECORD_A });
        control.init(context, () => undefined, {});
        const before = renderKey(control, context);

        const after = renderKey(control, makeContext({ recordId: RECORD_B }));

        expect(after).not.toBe(before);
    });

    it("treats a changed column as a boundary", () => {
        const { control, editor } = start({ recordId: RECORD_A, logicalName: "description" });
        edit(editor, "@Alex Rivera ", [alex]);
        const before = eventIds(control);

        const next = render(
            control,
            makeContext({ recordId: RECORD_A, logicalName: "ayonto_notes", value: "" })
        );
        edit(next, "@Alex Rivera ", [alex]);

        expect(eventIds(control)).not.toEqual(before);
    });
});

describe("MentionControl host reconciliation", () => {
    it("does not let a stale host echo revert the local text or its payload", () => {
        const { control, editor } = start({ value: "A" });
        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);
        const local = control.getOutputs();

        // The host reports the value the cycle started from.
        render(control, makeContext({ value: "A" }));

        expect(control.getOutputs().field).toBe("A@Alex Rivera ");
        expect(control.getOutputs().mentionMetadata).toBe(local.mentionMetadata);
    });

    it("does not let a stale companion echo revert the local payload", () => {
        const stale = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control, editor } = start({ value: "A", metadata: stale });
        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);
        const local = control.getOutputs().mentionMetadata;

        // The host echoes the old text *and* the old payload together.
        render(control, makeContext({ value: "A", metadata: stale }));

        expect(control.getOutputs().mentionMetadata).toBe(local);
        expect(payload(control).mentions).toHaveLength(1);
    });

    it("keeps its own payload when the host acknowledges the edit", () => {
        const { control, editor } = start({ value: "A" });
        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);
        const local = control.getOutputs().mentionMetadata ?? "";

        // The host reports the local value back: the edit landed.
        render(control, makeContext({ value: "A@Alex Rivera ", metadata: local }));

        expect(control.getOutputs().mentionMetadata).toBe(local);
    });

    it("takes a genuinely external value and the payload that comes with it", () => {
        const external = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control, editor } = start({ value: "A" });
        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);

        render(control, makeContext({ value: "decided elsewhere", metadata: external }));

        expect(control.getOutputs().field).toBe("decided elsewhere");
        expect(control.getOutputs().mentionMetadata).toBe(external);
    });

    it("drops a notification a host value took out of the text", () => {
        const { control, editor } = start({ value: "" });
        edit(editor, "@Alex Rivera ", [alex]);
        expect(payload(control).mentions).toHaveLength(1);
        notified = [];

        // A value decided elsewhere, adopted by the editor, without the mention.
        editor.onHostValueAdopted?.({ text: "decided elsewhere", mentions: [] });

        expect(payload(control).mentions).toEqual([]);
        expect(notified).toHaveLength(1);
    });

    it("says nothing when a host value leaves the mentions alone", () => {
        const { editor } = start({ value: "" });
        edit(editor, "@Alex Rivera ", [alex]);
        notified = [];

        editor.onHostValueAdopted?.({ text: "@Alex Rivera and more", mentions: [alex] });

        expect(notified).toEqual([]);
    });
});

describe("MentionControl output pairs", () => {
    it("does not let a stale companion echo roll the payload back, however often it repeats", () => {
        const M0 = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control, editor } = start({ value: "A", metadata: M0 });

        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);
        const t1 = control.getOutputs().field ?? "";
        const m1 = control.getOutputs().mentionMetadata ?? "";
        expect(m1).not.toBe(M0);

        // The host repeats the new text beside the payload from before it. Half
        // an output is no news, however many times it arrives.
        for (let report = 0; report < 3; report += 1) {
            render(control, makeContext({ value: t1, metadata: M0 }));
            expect(control.getOutputs().field).toBe(t1);
            expect(control.getOutputs().mentionMetadata).toBe(m1);
        }

        // The whole output, at last.
        render(control, makeContext({ value: t1, metadata: m1 }));
        expect(control.getOutputs().mentionMetadata).toBe(m1);

        // The cycle is closed, so the host is authoritative again.
        render(control, makeContext({ value: t1, metadata: M0 }));
        expect(control.getOutputs().mentionMetadata).toBe(M0);
    });

    it("keeps a payload the editor produced by adopting a host value", () => {
        const { control, editor } = start({ value: "" });
        edit(editor, "@Alex Rivera ", [alex]);
        const m1 = control.getOutputs().mentionMetadata ?? "";

        // A text decided elsewhere, reported with the session's own payload.
        render(control, makeContext({ value: "decided elsewhere", metadata: m1 }));
        // The editor adopts it and the mention is gone with it.
        editor.onHostValueAdopted?.({ text: "decided elsewhere", mentions: [] });
        const empty = control.getOutputs().mentionMetadata ?? "";
        expect(JSON.parse(empty)).toMatchObject({ mentions: [] });

        // The host has not written the new payload back yet, and says so twice.
        render(control, makeContext({ value: "decided elsewhere", metadata: m1 }));
        render(control, makeContext({ value: "decided elsewhere", metadata: m1 }));
        expect(control.getOutputs().mentionMetadata).toBe(empty);

        // The whole output closes the cycle.
        render(control, makeContext({ value: "decided elsewhere", metadata: empty }));
        expect(control.getOutputs().mentionMetadata).toBe(empty);
        render(control, makeContext({ value: "decided elsewhere", metadata: m1 }));
        expect(control.getOutputs().mentionMetadata).toBe(m1);
    });

    it("acknowledges an edit that put the text back where the cycle started", () => {
        const { control, editor } = start({ value: "A", metadata: "" });
        edit(editor, "A@Alex Rivera ", [{ ...alex, start: 1 }]);
        // Back to the text the cycle started from, but nobody is mentioned now.
        edit(editor, "A", []);
        const m2 = control.getOutputs().mentionMetadata ?? "";
        expect(m2).not.toBe("");

        // The baseline text with the baseline payload: one half is stale.
        render(control, makeContext({ value: "A", metadata: "" }));
        expect(control.getOutputs().mentionMetadata).toBe(m2);

        // The whole output, which happens to carry the baseline text.
        render(control, makeContext({ value: "A", metadata: m2 }));
        expect(control.getOutputs().mentionMetadata).toBe(m2);

        // Closed: the host decides again.
        render(control, makeContext({ value: "A", metadata: "" }));
        expect(control.getOutputs().mentionMetadata).toBe("");
    });

    it("ignores an earlier output whatever payload it arrives with", () => {
        const { control, editor } = start({ value: "A", metadata: "" });
        edit(editor, "T1", [alex]);
        const m1 = control.getOutputs().mentionMetadata ?? "";
        edit(editor, "T2", [dana]);
        const m2 = control.getOutputs().mentionMetadata ?? "";

        render(control, makeContext({ value: "T1", metadata: m1 }));
        expect(control.getOutputs().field).toBe("T2");
        expect(control.getOutputs().mentionMetadata).toBe(m2);

        render(control, makeContext({ value: "T1", metadata: "" }));
        expect(control.getOutputs().field).toBe("T2");
        expect(control.getOutputs().mentionMetadata).toBe(m2);
    });

    it("still lets a genuinely external text decide both halves", () => {
        const external = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control, editor } = start({ value: "A", metadata: "" });
        edit(editor, "T1", [alex]);
        edit(editor, "T2", [dana]);

        render(control, makeContext({ value: "decided elsewhere", metadata: external }));

        expect(control.getOutputs().field).toBe("decided elsewhere");
        expect(control.getOutputs().mentionMetadata).toBe(external);
    });
});

describe("MentionControl instances on one form", () => {
    it("keep their own payloads", () => {
        const first = start({ logicalName: "description" });
        const second = start({ logicalName: "ayonto_notes" });

        edit(first.editor, "@Alex Rivera ", [alex]);
        edit(second.editor, "@Dana Winter ", [dana]);

        expect(payload(first.control).sourceField).toBe("description");
        expect(payload(first.control).mentions[0]?.recipientUserId).toBe("u-alex");
        expect(payload(second.control).sourceField).toBe("ayonto_notes");
        expect(payload(second.control).mentions[0]?.recipientUserId).toBe("u-dana");
    });

    it("give their editors different listbox ids", () => {
        const first = start();
        const second = start();

        expect(first.editor.listboxId).not.toBe(second.editor.listboxId);
    });
});

describe("MentionControl when the companion column may not be written", () => {
    it("offers nobody, so no mention can be made that cannot be recorded", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, metadataEditable: false });

        type("@Da");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        // Nobody is looked up and no list appears: a mention made here could
        // never be saved, so it is never offered.
        expect(host.searches).toEqual([]);
        expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    });

    it("leaves a stored payload exactly as it is, mentions and all", async () => {
        // Non-empty on purpose: an empty one would look the same as whatever a
        // fresh session would write, and hide an overwrite completely.
        const stored =
            '{"schemaVersion":1,"sourceField":"description","mentions":' +
            '[{"eventId":"event-old","recipientUserId":"u-old"}]}';
        const host = makeHost();
        const { control } = start({
            webApi: host.webAPI,
            metadata: stored,
            metadataEditable: false,
        });

        type("plain text is still allowed");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(control.getOutputs().field).toBe("plain text is still allowed");
        expect(control.getOutputs().mentionMetadata).toBe(stored);
        // Nobody was looked up, and no notification of this session exists.
        expect(host.searches).toEqual([]);
        expect(host.writes).toEqual([]);
    });

    it("keeps the stored payload even when a mention is reported to it", () => {
        const stored =
            '{"schemaVersion":1,"sourceField":"description","mentions":' +
            '[{"eventId":"event-old","recipientUserId":"u-old"}]}';
        const { control, editor } = start({ metadata: stored, metadataEditable: false });

        // Even if a mention reached the adapter, nothing about it is recorded.
        edit(editor, "@Alex Rivera ", [alex]);

        expect(control.getOutputs().field).toBe("@Alex Rivera ");
        expect(control.getOutputs().mentionMetadata).toBe(stored);
    });

    it("keeps offering people when the column may be written", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, metadataEditable: true });

        type("@Da");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(host.searches).toHaveLength(1);
    });
});
