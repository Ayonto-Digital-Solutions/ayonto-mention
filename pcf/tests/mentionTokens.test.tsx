import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs } from "../MentionControl/generated/ManifestTypes";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import { resourceValue } from "./support/resources";

const RECORD_A = "aaaaaaaa-1111-2222-3333-444444444444";
const RECORD_B = "bbbbbbbb-5555-6666-7777-888888888888";

/** Fictional identifiers, in the canonical shape the control writes. */
const EVENT_A = "11111111-2222-4333-8444-555555555555";
const EVENT_B = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const USER_A = "aaaaaaaa-0000-1111-2222-333333333333";
const USER_B = "bbbbbbbb-0000-1111-2222-333333333333";

interface Span {
    readonly start: number;
    readonly length: number;
}

function payload(
    mentions: readonly { eventId: string; recipientUserId: string; occurrences: readonly Span[] }[],
    sourceField = "description"
): string {
    return JSON.stringify({ schemaVersion: 1, sourceField, mentions });
}

/** "Hello @Alex Rivera today", with Alex already recorded as a mention. */
const SAVED_TEXT = "Hello @Alex Rivera today";
const SAVED_METADATA = payload([
    { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 12 }] },
]);

interface OpenedForm {
    readonly entityName: string | undefined;
    readonly entityId: string | undefined;
}

interface Host {
    readonly webAPI: ComponentFramework.WebApi;
    readonly navigation: ComponentFramework.Navigation;
    readonly opened: OpenedForm[];
    failNextOpen(): void;
}

function makeHost(): Host {
    const opened: OpenedForm[] = [];
    let failNext = false;

    return {
        webAPI: {
            retrieveMultipleRecords: jest.fn(() =>
                Promise.resolve({ entities: [], nextLink: "" })
            ),
        } as unknown as ComponentFramework.WebApi,
        navigation: {
            openForm: jest.fn((options: ComponentFramework.NavigationApi.EntityFormOptions) => {
                opened.push({ entityName: options.entityName, entityId: options.entityId });
                if (failNext) {
                    failNext = false;
                    return Promise.reject(
                        new Error("Access denied at https://org-a1b2.example.invalid")
                    );
                }
                return Promise.resolve({ savedEntityReference: [] });
            }),
        } as unknown as ComponentFramework.Navigation,
        opened,
        failNextOpen: () => {
            failNext = true;
        },
    };
}

interface HostOptions {
    readonly value?: string;
    readonly metadata?: string;
    readonly readable?: boolean;
    readonly disabled?: boolean;
    readonly recordId?: string;
    readonly logicalName?: string;
    readonly host?: Host;
    readonly maxLength?: number;
}

function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    const host = options.host ?? makeHost();
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
                        : { editable: true, readable: options.readable, secured: true },
            },
            recordId: { raw: options.recordId ?? RECORD_A },
            recordTable: { raw: "account" },
            mentionMetadata: { raw: options.metadata ?? "" },
        },
        mode: { isControlDisabled: options.disabled ?? false, label: "Comment" },
        client: {
            disableScroll: false,
            getClient: () => "Web",
            getFormFactor: () => 1,
            isOffline: () => false,
            isNetworkAvailable: () => true,
        },
        navigation: host.navigation,
        resources: { getString: (id: string) => resourceValue(id) },
        formatting: { formatInteger: (value: number) => value.toString() },
        webAPI: host.webAPI,
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;
let notifyCount = 0;

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

function reader(): HTMLElement | null {
    return container.querySelector('[role="presentation"]');
}

/** The mention tokens on screen, in order. */
function tokens(): readonly HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("button"));
}

function tokenAt(index: number): HTMLElement {
    const token = tokens()[index];
    if (token === undefined) {
        throw new Error(`expected a mention token at index ${index.toString()}`);
    }
    return token;
}

/**
 * The text around the tokens, exactly as it stands in the field.
 *
 * Read off the direct text nodes, so the initials an avatar draws are not
 * mistaken for text the record holds.
 */
function plainRuns(): string {
    const surface = reader();
    if (surface === null) {
        throw new Error("the field is not in read mode");
    }
    return Array.from(surface.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("");
}

function enterEditing(): void {
    const surface = reader();
    if (surface === null) {
        throw new Error("the field is not in read mode");
    }
    act(() => {
        Simulate.click(surface);
    });
}

function type(next: string, caret: number = next.length): void {
    const element = requiredField();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
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

describe("a saved record with a mention in it", () => {
    it("shows the person as a token, and the rest as text", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        expect(field()).toBeNull();
        expect(tokens()).toHaveLength(1);
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        // The characters around it are still the characters that were saved.
        expect(plainRuns()).toBe("Hello  today");
    });

    it("names the token for somebody who cannot see it", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        expect(tokenAt(0).getAttribute("aria-label")).toBe(
            resourceValue("Editor_OpenMentionedUser").replace("{0}", "Alex Rivera")
        );
    });

    it("gives the token an avatar that is not separately reachable", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        const avatar = tokenAt(0).querySelector('[aria-hidden="true"]');
        expect(avatar).not.toBeNull();
        expect(tokens()).toHaveLength(1);
    });

    it("leaves a name that was only typed as ordinary text", () => {
        start({ value: "Hello @Alex Rivera today", metadata: "" });

        expect(tokens()).toEqual([]);
        expect(field()?.value).toBe("Hello @Alex Rivera today");
    });

    it("leaves a stale occurrence as ordinary text", () => {
        // The payload points past the end of the text it was saved with.
        const stale = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 60, length: 12 }] },
        ]);

        start({ value: SAVED_TEXT, metadata: stale });

        expect(tokens()).toEqual([]);
    });

    it("keeps two namesakes apart", () => {
        const text = "@Robin Fox and @Robin Fox ";
        const both = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 10 }] },
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 15, length: 10 }] },
        ]);

        start({ value: text, metadata: both });

        expect(tokens()).toHaveLength(2);
        expect(tokenAt(0).textContent).toContain("Robin Fox");
        expect(tokenAt(1).textContent).toContain("Robin Fox");
    });

    it("keeps line breaks and runs of spaces exactly as they were saved", () => {
        const text = "First line\n\n  @Alex Rivera  after";
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 14, length: 12 }] },
        ]);

        start({ value: text, metadata: raw });

        // Every line break and every space between the words survives; only the
        // mention itself is drawn as a person.
        expect(plainRuns()).toBe("First line\n\n    after");
        expect(tokens()).toHaveLength(1);
    });

    it("still says how much room is left while reading", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, maxLength: 100 });

        expect(container.textContent).toContain(
            resourceValue("Editor_CharactersLeft").replace("{0}", "76")
        );
    });

    it("shows nothing at all when the column may not be read", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, readable: false });

        expect(tokens()).toEqual([]);
        expect(container.textContent).not.toContain("Alex Rivera");
        expect(container.innerHTML).not.toContain("Alex Rivera");
        expect(container.textContent).toContain(resourceValue("Editor_MaskedValue"));
    });

    it("still shows the people on a read-only field, without becoming editable", () => {
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, disabled: true });

        expect(tokens()).toHaveLength(1);
        enterEditing();
        expect(field()).toBeNull();
    });
});

describe("opening the person a mention names", () => {
    it("opens exactly that Dataverse user", () => {
        const host = makeHost();
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        act(() => {
            Simulate.click(tokenAt(0));
        });

        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_A }]);
    });

    it("opens different people for two namesakes", () => {
        const host = makeHost();
        const text = "@Robin Fox and @Robin Fox ";
        start({
            value: text,
            host,
            metadata: payload([
                { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 10 }] },
                { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 15, length: 10 }] },
            ]),
        });

        act(() => {
            Simulate.click(tokenAt(0));
        });
        act(() => {
            Simulate.click(tokenAt(1));
        });

        expect(host.opened.map((form) => form.entityId)).toEqual([USER_A, USER_B]);
    });

    it("opens from the keyboard", () => {
        const host = makeHost();
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        // The token is a button: the browser turns Enter and Space into a click,
        // and the element is reachable by Tab because nothing removes it.
        expect(tokenAt(0).tagName).toBe("BUTTON");
        expect(tokenAt(0).getAttribute("tabindex")).not.toBe("-1");
        act(() => {
            Simulate.click(tokenAt(0), { detail: 0 });
        });

        expect(host.opened).toHaveLength(1);
    });

    it("does not open anything when ordinary text is clicked", () => {
        const host = makeHost();
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        enterEditing();

        expect(host.opened).toEqual([]);
    });

    it("does not put the editor into editing when a token is clicked", () => {
        const host = makeHost();
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        act(() => {
            Simulate.click(tokenAt(0));
        });

        expect(field()).toBeNull();
        expect(tokens()).toHaveLength(1);
    });

    it("says nothing to the user when the form cannot be opened", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const host = makeHost();
        start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
        host.failNextOpen();

        act(() => {
            Simulate.click(tokenAt(0));
        });
        await flush();

        // The text is still perfectly readable, and nothing about the
        // environment reaches the user or the console.
        expect(plainRuns()).toBe("Hello  today");
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        expect(container.textContent).not.toContain("example.invalid");
        expect(errors).not.toHaveBeenCalled();
        expect(warnings).not.toHaveBeenCalled();
        errors.mockRestore();
        warnings.mockRestore();
    });
});

describe("moving between reading and editing", () => {
    it("shows the same text, and keeps the identities", () => {
        const { control } = start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const text = control.getOutputs().field;
        const metadata = control.getOutputs().mentionMetadata;
        notifyCount = 0;

        enterEditing();

        expect(field()?.value).toBe(SAVED_TEXT);
        expect(control.getOutputs().field).toBe(text);
        expect(control.getOutputs().mentionMetadata).toBe(metadata);
        expect(notifyCount).toBe(0);
    });

    it("returns to the tokens when editing ends, unchanged", () => {
        const { control } = start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const metadata = control.getOutputs().mentionMetadata;
        enterEditing();
        notifyCount = 0;

        act(() => {
            Simulate.blur(requiredField());
        });

        expect(field()).toBeNull();
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(metadata);
        expect(notifyCount).toBe(0);
    });

    it("carries the identity the record had into the next edit", () => {
        const { control } = start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        enterEditing();

        // An edit somewhere else in the text: the mention only moves.
        type(`Hi. ${SAVED_TEXT}`);

        const written = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: { eventId: string; recipientUserId: string; occurrences: Span[] }[];
        };
        expect(written.mentions).toHaveLength(1);
        // Same notification as the record already carried, at its new place.
        expect(written.mentions[0]?.eventId).toBe(EVENT_A);
        expect(written.mentions[0]?.recipientUserId).toBe(USER_A);
        expect(written.mentions[0]?.occurrences).toEqual([{ start: 10, length: 12 }]);
    });

    it("ends the episode when the mention is deleted, and starts a new one later", () => {
        const { control } = start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        enterEditing();

        type("Hello  today");
        const emptied = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: unknown[];
        };

        expect(emptied.mentions).toEqual([]);
    });

    it("forgets the record's identities at a record boundary", () => {
        const { control } = start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        expect(tokens()).toHaveLength(1);

        render(control, makeContext({ recordId: RECORD_B, value: "", metadata: "" }));

        expect(tokens()).toEqual([]);
        expect(control.getOutputs().mentionMetadata).toBe("");
    });

    it("refuses a payload that belongs to another column", () => {
        start({
            value: SAVED_TEXT,
            metadata: payload(
                [
                    {
                        eventId: EVENT_A,
                        recipientUserId: USER_A,
                        occurrences: [{ start: 6, length: 12 }],
                    },
                ],
                "ayonto_notes"
            ),
        });

        expect(tokens()).toEqual([]);
    });
});
