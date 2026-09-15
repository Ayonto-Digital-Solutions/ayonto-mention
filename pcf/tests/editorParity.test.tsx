import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs } from "../MentionControl/generated/ManifestTypes";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import { readResources, resourceValue } from "./support/resources";

const RECORD_A = "aaaaaaaa-1111-2222-3333-444444444444";

/** A fictional person, and a secret only the field itself should ever hold. */
const SECRET = "Confidential: @Alex Rivera owes me a review";
const alex: MentionOccurrence = { start: 3, name: "Alex Rivera", userId: "u-alex" };

interface Host {
    readonly webAPI: ComponentFramework.WebApi;
    readonly searches: string[];
    settleSearch(index: number, users: readonly { id: string; name: string }[]): Promise<void>;
}

function makeHost(): Host {
    const searches: string[] = [];
    const resolvers: ((value: unknown) => void)[] = [];

    return {
        webAPI: {
            createRecord: jest.fn(),
            retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
                searches.push(`${entity} ${options ?? ""}`);
                return new Promise((resolve) => resolvers.push(resolve));
            }),
        } as unknown as ComponentFramework.WebApi,
        searches,
        settleSearch: async (index, users) => {
            resolvers[index]?.({
                entities: users.map((user) => ({
                    systemuserid: user.id,
                    fullname: user.name,
                    internalemailaddress: null,
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
    readonly readable?: boolean;
    readonly editable?: boolean;
    readonly metadata?: string;
    readonly metadataEditable?: boolean;
    readonly maxLength?: number;
    readonly offline?: boolean;
    readonly networkAvailable?: boolean;
    readonly webApi?: ComponentFramework.WebApi;
    /** Leaves the two offline methods out, as a host that has none would. */
    readonly withoutClientMethods?: boolean;
}

function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    const client = options.withoutClientMethods === true
        ? { disableScroll: false, getClient: () => "Web", getFormFactor: () => 1 }
        : {
              disableScroll: false,
              getClient: () => "Web",
              getFormFactor: () => 1,
              isOffline: () => options.offline === true,
              isNetworkAvailable: () => options.networkAvailable !== false,
          };

    return {
        parameters: {
            field: {
                raw: options.value ?? "",
                attributes: { MaxLength: options.maxLength, LogicalName: "description" },
                security:
                    options.readable === undefined && options.editable === undefined
                        ? undefined
                        : {
                              editable: options.editable ?? true,
                              readable: options.readable ?? true,
                              secured: true,
                          },
            },
            recordId: { raw: RECORD_A },
            recordTable: { raw: "account" },
            mentionMetadata: {
                raw: options.metadata ?? "",
                security:
                    options.metadataEditable === undefined
                        ? undefined
                        : { editable: options.metadataEditable, readable: true, secured: true },
            },
        },
        mode: { isControlDisabled: false, label: "Comment" },
        client,
        resources: { getString: (id: string) => resourceValue(id) },
        formatting: { formatInteger: (value: number) => value.toString() },
        webAPI: options.webApi ?? makeHost().webAPI,
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;

function start(options: HostOptions = {}): {
    control: MentionControl;
    editor: MentionEditorProps;
} {
    const control = new MentionControl();
    const context = makeContext(options);
    control.init(context, () => undefined, {});
    return { control, editor: render(control, context) };
}

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

function field(): HTMLTextAreaElement | null {
    return container.querySelector("textarea");
}

function requiredField(): HTMLTextAreaElement {
    const element = field();
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

function type(next: string, caret: number = next.length): void {
    const element = requiredField();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
    });
}

/** Presses a key and reports what the field ends up selecting, as a browser would. */
function press(key: string, caret: number, selectionEnd: number = caret): { start: number; end: number } {
    const element = requiredField();
    act(() => {
        element.setSelectionRange(caret, selectionEnd);
        Simulate.keyDown(element, { key });
    });
    return { start: element.selectionStart ?? -1, end: element.selectionEnd ?? -1 };
}

/** Deletes whatever the field has selected, the way the browser then would. */
function applyDeletion(): void {
    const element = requiredField();
    const before = element.value;
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    type(before.slice(0, start) + before.slice(end), start);
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stub(): void {
            // not what these tests are about
        },
    });
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
});

describe("a column the user may not read", () => {
    it("never puts the value anywhere in the rendered output", () => {
        const { control } = start({ value: SECRET, readable: false });

        expect(container.innerHTML).not.toContain("Confidential");
        expect(container.innerHTML).not.toContain("Alex Rivera");
        expect(container.textContent).not.toContain("Confidential");
        // Not in an attribute either, and not in a field the browser would fill.
        expect(field()).toBeNull();
        // The host's own value is still reported back untouched.
        expect(control.getOutputs().field).toBe(SECRET);
    });

    it("shows the masked placeholder instead", () => {
        start({ value: SECRET, readable: false });

        expect(container.textContent).toContain(resourceValue("Editor_MaskedValue"));
    });

    it("hands the editor nothing to show", () => {
        const { editor } = start({ value: SECRET, readable: false });

        expect(editor.value).toBe("");
        expect(editor.masked).toBe(true);
        expect(editor.disabled).toBe(true);
        expect(editor.canMention).toBe(false);
    });

    it("keeps the stored metadata exactly as the host holds it", () => {
        const stored = '{"schemaVersion":1,"sourceField":"description","mentions":[]}';
        const { control } = start({ value: SECRET, readable: false, metadata: stored });

        expect(control.getOutputs().mentionMetadata).toBe(stored);
    });

    it("shows the value again once the column becomes readable", () => {
        const control = new MentionControl();
        const context = makeContext({ value: SECRET, readable: false });
        control.init(context, () => undefined, {});
        render(control, context);
        expect(field()).toBeNull();

        render(control, makeContext({ value: SECRET, readable: true }));

        expect(requiredField().value).toBe(SECRET);
    });
});

describe("a column the user may not write", () => {
    it("stays read-only and offers nobody", () => {
        const { editor } = start({ value: "Hello", editable: false });

        expect(editor.disabled).toBe(true);
        expect(requiredField().disabled).toBe(true);
    });
});

describe("a companion column the user may not write", () => {
    it("offers nobody and keeps the stored metadata", async () => {
        const stored =
            '{"schemaVersion":1,"sourceField":"description","mentions":' +
            '[{"eventId":"event-old","recipientUserId":"u-old"}]}';
        const host = makeHost();
        const { control } = start({
            webApi: host.webAPI,
            metadata: stored,
            metadataEditable: false,
        });

        type("@Al");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(host.searches).toEqual([]);
        expect(control.getOutputs().mentionMetadata).toBe(stored);
    });
});

describe("a client with no connection", () => {
    it("says why mentioning is unavailable", () => {
        const { editor } = start({ offline: true });

        expect(editor.notice).toBe(resourceValue("Editor_OfflineNotice"));
        expect(container.textContent).toContain(resourceValue("Editor_OfflineNotice"));
    });

    it("leaves the text editable", () => {
        const { control } = start({ offline: true });

        type("still typing offline");

        expect(requiredField().disabled).toBe(false);
        expect(control.getOutputs().field).toBe("still typing offline");
    });

    it("opens no picker and sends no lookup", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, offline: true });

        type("@Al");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(host.searches).toEqual([]);
        expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    });

    it("treats an unavailable network the same way", () => {
        const { editor } = start({ networkAvailable: false });

        expect(editor.notice).toBe(resourceValue("Editor_OfflineNotice"));
    });

    it("looks people up again when the connection is back", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI, offline: false });

        type("@Al");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();

        expect(host.searches).toHaveLength(1);
    });

    it("says nothing when the host does not answer the question", async () => {
        // A host without those methods is not known to be offline, and the
        // control must not invent an outage from that.
        const host = makeHost();
        const { editor } = start({ webApi: host.webAPI, withoutClientMethods: true });

        expect(editor.notice).toBeUndefined();
        type("@Al");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await flush();
        expect(host.searches).toHaveLength(1);
    });
});

describe("deleting a mention", () => {
    /** Picks Alex through the real picker, leaving "Hi @Alex Rivera ". */
    async function pickAlex(host: Host): Promise<void> {
        type("Hi @Al");
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await host.settleSearch(0, [{ id: alex.userId, name: alex.name }]);
        act(() => {
            Simulate.keyDown(requiredField(), { key: "Enter" });
        });
    }

    it("selects the whole mention on Backspace behind it", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });
        await pickAlex(host);
        expect(requiredField().value).toBe("Hi @Alex Rivera ");

        const selection = press("Backspace", 15);

        expect(selection).toEqual({ start: 3, end: 16 });
    });

    it("selects the whole mention on Delete in front of it", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });
        await pickAlex(host);

        expect(press("Delete", 3)).toEqual({ start: 3, end: 16 });
    });

    it("selects the whole mention from inside it", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });
        await pickAlex(host);

        expect(press("Backspace", 9)).toEqual({ start: 3, end: 16 });
    });

    it("leaves the key alone in ordinary text", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });
        await pickAlex(host);

        // Right after "Hi", nowhere near the mention.
        expect(press("Backspace", 2)).toEqual({ start: 2, end: 2 });
    });

    it("obeys a selection the user made themselves", async () => {
        const host = makeHost();
        start({ webApi: host.webAPI });
        await pickAlex(host);

        expect(press("Backspace", 0, 2)).toEqual({ start: 0, end: 2 });
    });

    it("does not touch a name that was only typed", () => {
        start();
        type("Hi @Alex Rivera thanks");

        expect(press("Backspace", 15)).toEqual({ start: 15, end: 15 });
    });

    it("ends the recipient's episode once the mention is gone", async () => {
        const host = makeHost();
        const { control } = start({ webApi: host.webAPI });
        await pickAlex(host);
        const before = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: { eventId: string }[];
        };
        expect(before.mentions).toHaveLength(1);

        press("Backspace", 15);
        applyDeletion();

        expect(requiredField().value).toBe("Hi ");
        const after = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: unknown[];
        };
        expect(after.mentions).toEqual([]);
    });

    it("gives a new identity when the person is mentioned again", async () => {
        const host = makeHost();
        const { control } = start({ webApi: host.webAPI });
        await pickAlex(host);
        const first = (
            JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
                mentions: { eventId: string }[];
            }
        ).mentions[0]?.eventId;

        press("Backspace", 15);
        applyDeletion();
        type("Hi @Al", 6);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await host.settleSearch(1, [{ id: alex.userId, name: alex.name }]);
        act(() => {
            Simulate.keyDown(requiredField(), { key: "Enter" });
        });

        const second = (
            JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
                mentions: { eventId: string }[];
            }
        ).mentions[0]?.eventId;
        expect(second).toBeDefined();
        expect(second).not.toBe(first);
    });
});

describe("the remaining-character count", () => {
    it("is shown when the column has a limit", () => {
        start({ maxLength: 100, value: "12345" });

        expect(container.textContent).toContain(resourceValue("Editor_CharactersLeft").replace("{0}", "95"));
    });

    it("follows the text as it is typed", () => {
        start({ maxLength: 100 });

        type("abcdefghij");

        expect(container.textContent).toContain(resourceValue("Editor_CharactersLeft").replace("{0}", "90"));
    });

    it("is left out when the column has no limit", () => {
        start({ value: "12345" });

        expect(container.textContent).not.toContain("characters left");
    });

    it("names the count from the field, rather than announcing it on every keystroke", () => {
        start({ maxLength: 100 });

        const describedBy = requiredField().getAttribute("aria-describedby");
        expect(describedBy).not.toBeNull();
        expect(container.querySelector(`#${describedBy ?? ""}`)?.textContent).toContain("100");
    });
});

describe("the shipped resources", () => {
    const english = readResources("1033");
    const german = readResources("1031");

    it("ship the same keys in both languages", () => {
        expect([...german.keys()].sort()).toEqual([...english.keys()].sort());
    });

    it("carry every string the editor needs", () => {
        for (const key of [
            "Editor_NoResults",
            "Editor_Searching",
            "Editor_LookupFailed",
            "Editor_MentionTooLong",
            "Editor_MoreResults",
            "Editor_SuggestionCount",
            "Editor_SuggestionCountOne",
            "Editor_CharactersLeft",
            "Editor_OfflineNotice",
            "Editor_MaskedValue",
        ]) {
            expect(english.get(key)?.length ?? 0).toBeGreaterThan(0);
            expect(german.get(key)?.length ?? 0).toBeGreaterThan(0);
        }
    });

    it("name every property the manifest configures", () => {
        for (const key of [
            "MentionControl_Display_Key",
            "MentionControl_Desc_Key",
            "Field_Display_Key",
            "Field_Desc_Key",
            "RecordId_Display_Key",
            "RecordId_Desc_Key",
            "RecordTable_Display_Key",
            "RecordTable_Desc_Key",
            "MentionMetadata_Display_Key",
            "MentionMetadata_Desc_Key",
        ]) {
            expect(english.has(key)).toBe(true);
            expect(german.has(key)).toBe(true);
        }
    });

    it("keep the placeholder in the strings that take a number", () => {
        for (const key of ["Editor_SuggestionCount", "Editor_SuggestionCountOne", "Editor_CharactersLeft"]) {
            expect(english.get(key)).toContain("{0}");
            expect(german.get(key)).toContain("{0}");
        }
    });

    it("are actually translated, not copied", () => {
        const translated = [
            "Editor_NoResults",
            "Editor_Searching",
            "Editor_LookupFailed",
            "Editor_OfflineNotice",
            "Editor_CharactersLeft",
        ];

        for (const key of translated) {
            expect(german.get(key)).not.toBe(english.get(key));
        }
    });
});
