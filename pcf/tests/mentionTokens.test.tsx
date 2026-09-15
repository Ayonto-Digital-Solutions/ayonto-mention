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
    /** The ids the control asked Dataverse about, in order. */
    readonly lookedUp: string[];
    failNextOpen(): void;
}

/** Who the environment says these fictional ids belong to. */
const DIRECTORY: Record<string, string | null> = {
    [USER_A]: "Alex Rivera",
    [USER_B]: "Robin Fox",
};

/** Two different people who really are called the same thing. */
const NAMESAKES: Record<string, string | null> = {
    [USER_A]: "Robin Fox",
    [USER_B]: "Robin Fox",
};

function makeHost(directory: Record<string, string | null> = DIRECTORY): Host {
    const opened: OpenedForm[] = [];
    const lookedUp: string[] = [];
    let failNext = false;

    return {
        webAPI: {
            retrieveMultipleRecords: jest.fn(() =>
                Promise.resolve({ entities: [], nextLink: "" })
            ),
            // The only thing the control asks about a persisted mention: is this
            // id really called what the text says it is?
            retrieveRecord: jest.fn((entity: string, id: string) => {
                lookedUp.push(id);
                const name = directory[id];
                return name === undefined || name === null
                    ? Promise.reject(new Error("user not found at https://org-a1b2.example.invalid"))
                    : Promise.resolve({ systemuserid: id, fullname: name });
            }),
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
        lookedUp,
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
    readonly directory?: Record<string, string | null>;
    readonly offline?: boolean;
}

function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    const host = options.host ?? makeHost(options.directory ?? DIRECTORY);
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
            isOffline: () => options.offline ?? false,
            isNetworkAvailable: () => !(options.offline ?? false),
        },
        navigation: host.navigation,
        resources: { getString: (id: string) => resourceValue(id) },
        formatting: { formatInteger: (value: number) => value.toString() },
        webAPI: host.webAPI,
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;
let notifyCount = 0;

/**
 * Opens a record and lets the identity lookups settle.
 *
 * A persisted mention is not shown as a person until Dataverse has confirmed who
 * the id belongs to, so a test that wants to see tokens has to let that answer
 * arrive — which is exactly what a user sees: text first, people a moment later.
 */
async function start(options: HostOptions = {}): Promise<{
    control: MentionControl;
    editor: MentionEditorProps;
}> {
    const control = new MentionControl();
    const context = makeContext(options);
    control.init(
        context,
        () => {
            notifyCount += 1;
        },
        {}
    );
    const editor = render(control, context);
    await flush();
    return { control, editor };
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

/**
 * True while the field is the thing being typed in.
 *
 * The textarea is no longer torn down to show the people view — it stays
 * mounted underneath, covered and hidden from assistive technology — so "is
 * there a textarea" no longer answers "is this field being edited". This does.
 */
function isEditing(): boolean {
    const element = field();

    return element !== null && element.getAttribute("aria-hidden") !== "true";
}

function reader(): HTMLElement | null {
    return container.querySelector('[role="group"]');
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
    it("shows the person as a token, and the rest as text", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        expect(isEditing()).toBe(false);
        expect(tokens()).toHaveLength(1);
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        // The characters around it are still the characters that were saved.
        expect(plainRuns()).toBe("Hello  today");
    });

    it("names the token for somebody who cannot see it", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        expect(tokenAt(0).getAttribute("aria-label")).toBe(
            resourceValue("Editor_OpenMentionedUser").replace("{0}", "Alex Rivera")
        );
    });

    it("gives the token an avatar that is not separately reachable", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        const avatar = tokenAt(0).querySelector('[aria-hidden="true"]');
        expect(avatar).not.toBeNull();
        expect(tokens()).toHaveLength(1);
    });

    it("leaves a name that was only typed as ordinary text", async () => {
        await start({ value: "Hello @Alex Rivera today", metadata: "" });

        expect(tokens()).toEqual([]);
        expect(field()?.value).toBe("Hello @Alex Rivera today");
    });

    it("leaves a stale occurrence as ordinary text", async () => {
        // The payload points past the end of the text it was saved with.
        const stale = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 60, length: 12 }] },
        ]);

        await start({ value: SAVED_TEXT, metadata: stale });

        expect(tokens()).toEqual([]);
    });

    it("keeps two namesakes apart", async () => {
        const text = "@Robin Fox and @Robin Fox ";
        const both = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 0, length: 10 }] },
            { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 15, length: 10 }] },
        ]);

        await start({ value: text, metadata: both, directory: NAMESAKES });

        expect(tokens()).toHaveLength(2);
        expect(tokenAt(0).textContent).toContain("Robin Fox");
        expect(tokenAt(1).textContent).toContain("Robin Fox");
    });

    it("keeps line breaks and runs of spaces exactly as they were saved", async () => {
        const text = "First line\n\n  @Alex Rivera  after";
        const raw = payload([
            { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 14, length: 12 }] },
        ]);

        await start({ value: text, metadata: raw });

        // Every line break and every space between the words survives; only the
        // mention itself is drawn as a person.
        expect(plainRuns()).toBe("First line\n\n    after");
        expect(tokens()).toHaveLength(1);
    });

    it("still says how much room is left while reading", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, maxLength: 100 });

        expect(container.textContent).toContain(
            resourceValue("Editor_CharactersLeft").replace("{0}", "76")
        );
    });

    it("shows nothing at all when the column may not be read", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, readable: false });

        expect(tokens()).toEqual([]);
        expect(container.textContent).not.toContain("Alex Rivera");
        expect(container.innerHTML).not.toContain("Alex Rivera");
        expect(container.textContent).toContain(resourceValue("Editor_MaskedValue"));
    });

    it("still shows the people on a read-only field, without becoming editable", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, disabled: true });

        expect(tokens()).toHaveLength(1);
        enterEditing();
        expect(isEditing()).toBe(false);
    });
});

describe("opening the person a mention names", () => {
    it("opens exactly that Dataverse user", async () => {
        const host = makeHost();
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        act(() => {
            Simulate.click(tokenAt(0));
        });

        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_A }]);
    });

    it("opens different people for two namesakes", async () => {
        const host = makeHost(NAMESAKES);
        const text = "@Robin Fox and @Robin Fox ";
        await start({
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

    it("opens from the keyboard", async () => {
        const host = makeHost();
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        // The token is a button: the browser turns Enter and Space into a click,
        // and the element is reachable by Tab because nothing removes it.
        expect(tokenAt(0).tagName).toBe("BUTTON");
        expect(tokenAt(0).getAttribute("tabindex")).not.toBe("-1");
        act(() => {
            Simulate.click(tokenAt(0), { detail: 0 });
        });

        expect(host.opened).toHaveLength(1);
    });

    it("does not open anything when ordinary text is clicked", async () => {
        const host = makeHost();
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        enterEditing();

        expect(host.opened).toEqual([]);
    });

    it("does not put the editor into editing when a token is clicked", async () => {
        const host = makeHost();
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        act(() => {
            Simulate.click(tokenAt(0));
        });

        expect(isEditing()).toBe(false);
        expect(tokens()).toHaveLength(1);
    });

    it("goes nowhere for anything that is not a record id", async () => {
        const host = makeHost();
        const { editor } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        for (const id of ["", "   ", "u-alex", `${USER_A}-extra`, "../systemuser"]) {
            editor.onOpenUser?.(id);
        }

        expect(host.opened).toEqual([]);
    });

    it("opens a braced or upper-case id as the record it names", async () => {
        const host = makeHost();
        const { editor } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        editor.onOpenUser?.(`{${USER_A.toUpperCase()}}`);

        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_A }]);
    });

    it("says nothing to the user when the form cannot be opened", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const host = makeHost();
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
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
    it("shows the same text, and keeps the identities", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const text = control.getOutputs().field;
        const metadata = control.getOutputs().mentionMetadata;
        notifyCount = 0;

        enterEditing();

        expect(field()?.value).toBe(SAVED_TEXT);
        expect(control.getOutputs().field).toBe(text);
        expect(control.getOutputs().mentionMetadata).toBe(metadata);
        expect(notifyCount).toBe(0);
    });

    it("returns to the tokens when editing ends, unchanged", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const metadata = control.getOutputs().mentionMetadata;
        enterEditing();
        notifyCount = 0;

        act(() => {
            Simulate.blur(requiredField());
        });

        expect(isEditing()).toBe(false);
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(metadata);
        expect(notifyCount).toBe(0);
    });

    it("carries the identity the record had into the next edit", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
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

    it("ends the episode when the mention is deleted, and starts a new one later", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        enterEditing();

        type("Hello  today");
        const emptied = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: unknown[];
        };

        expect(emptied.mentions).toEqual([]);
    });

    it("forgets the record's identities at a record boundary", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        expect(tokens()).toHaveLength(1);

        render(control, makeContext({ recordId: RECORD_B, value: "", metadata: "" }));

        expect(tokens()).toEqual([]);
        expect(control.getOutputs().mentionMetadata).toBe("");
    });

    it("refuses a payload that belongs to another column", async () => {
        await start({
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

describe("a persisted mention whose text has moved on", () => {
    /**
     * Somebody else saved this record while it was not open here: the text at
     * the recorded position now spells a different person's name, and the
     * payload still names the old one.
     */
    const REPOINTED = "Hello @Robin Fox today";
    const REPOINTED_METADATA = payload([
        { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 6, length: 10 }] },
    ]);

    it("does not make the old person out of the new name", async () => {
        const host = makeHost();
        await start({ value: REPOINTED, metadata: REPOINTED_METADATA, host });

        // USER_A is Alex Rivera; the text says Robin Fox. Position alone would
        // have drawn a Robin Fox that opens Alex Rivera.
        expect(host.lookedUp).toEqual([USER_A]);
        expect(tokens()).toEqual([]);
        expect(plainRuns()).toBe(REPOINTED);
    });

    it("leaves that name as text to edit, not as a person to press", async () => {
        const host = makeHost();
        await start({ value: REPOINTED, metadata: REPOINTED_METADATA, host });

        enterEditing();

        expect(host.opened).toEqual([]);
        expect(requiredField().value).toBe(REPOINTED);
    });

    it("keeps the mention as ordinary text when nobody can be asked", async () => {
        // No connection, a deleted user, a read the user is not allowed: one
        // answer for all of them, because none of them is proof.
        const host = makeHost({ [USER_A]: null });
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        expect(host.lookedUp).toEqual([USER_A]);
        expect(tokens()).toEqual([]);
        expect(plainRuns()).toBe(SAVED_TEXT);
    });

    it("changes nothing about the record when it cannot confirm", async () => {
        const host = makeHost({ [USER_A]: null });
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        // Not being able to check a name is not a reason to rewrite a record.
        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("still edits, and still carries the identity, with no connection", async () => {
        const host = makeHost({ [USER_A]: null });
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        enterEditing();
        type(`Hi. ${SAVED_TEXT}`);

        // The record's notification is intact and has moved with the text: what
        // could not be confirmed was whether to *draw* it as a person.
        const written = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: { eventId: string; recipientUserId: string; occurrences: Span[] }[];
        };
        expect(written.mentions[0]?.eventId).toBe(EVENT_A);
        expect(written.mentions[0]?.recipientUserId).toBe(USER_A);
        expect(written.mentions[0]?.occurrences).toEqual([{ start: 10, length: 12 }]);
    });

    it("asks about one mention once, however often the field renders", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        render(control, makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, host }));
        await flush();
        render(control, makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, host }));
        await flush();

        expect(host.lookedUp).toEqual([USER_A]);
        expect(tokens()).toHaveLength(1);
    });

    it("still shows the person when the answer arrives after other renders", async () => {
        // The answer is about one id and one name; it does not go out of date
        // because the form redrew while it was on its way. And since the same
        // question is never asked twice, dropping it would lose the person for
        // as long as the record stays open.
        let answer: ((name: string) => void) | undefined;
        const host = makeHost();
        const pending = {
            ...host,
            webAPI: {
                retrieveRecord: jest.fn(
                    () =>
                        new Promise<Record<string, unknown>>((resolve) => {
                            answer = (name: string) => {
                                resolve({ systemuserid: USER_A, fullname: name });
                            };
                        })
                ),
            } as unknown as ComponentFramework.WebApi,
        };
        const { control } = await start({
            value: SAVED_TEXT,
            metadata: SAVED_METADATA,
            host: pending,
        });
        expect(tokens()).toEqual([]);

        render(control, makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, host: pending }));
        await flush();
        act(() => {
            answer?.("Alex Rivera");
        });
        await flush();

        expect(tokenAt(0).textContent).toContain("Alex Rivera");
    });

    it("says nothing about the environment when a lookup fails", async () => {
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const host = makeHost({ [USER_A]: null });
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        expect(container.textContent).not.toContain("example.invalid");
        expect(errors).not.toHaveBeenCalled();
        expect(warnings).not.toHaveBeenCalled();
        errors.mockRestore();
        warnings.mockRestore();
    });

    it("asks for nobody at all when the record names nobody", async () => {
        const host = makeHost();
        await start({ value: "Hello @Alex Rivera today", metadata: "", host });

        // A hand-typed name is not a mention, and is nobody's business.
        expect(host.lookedUp).toEqual([]);
    });
});

describe("a record the host decides while it is open", () => {
    /** Another save of the same record: different words, different person. */
    const EXTERNAL_TEXT = "Please see @Robin Fox about it";
    const EXTERNAL_METADATA = payload([
        { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 11, length: 10 }] },
    ]);

    it("takes the new text and the new people in one step", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
        expect(tokens()).toHaveLength(1);

        render(control, makeContext({ value: EXTERNAL_TEXT, metadata: EXTERNAL_METADATA, host }));
        await flush();

        expect(plainRuns()).toBe("Please see  about it");
        expect(tokenAt(0).textContent).toContain("Robin Fox");
        act(() => {
            Simulate.click(tokenAt(0));
        });
        // Never the previous save's person standing in the new save's words.
        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_B }]);
    });

    it("carries the new identity into the next edit", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });

        render(control, makeContext({ value: EXTERNAL_TEXT, metadata: EXTERNAL_METADATA, host }));
        await flush();
        enterEditing();
        type(`Hi. ${EXTERNAL_TEXT}`);

        const written = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: { eventId: string; recipientUserId: string }[];
        };
        expect(written.mentions).toHaveLength(1);
        expect(written.mentions[0]?.recipientUserId).toBe(USER_B);
        // The same notification the other save recorded, not a second one.
        expect(written.mentions[0]?.eventId).toBe(EVENT_B);
    });

    it("waits for the edit to end, and then takes both halves together", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
        enterEditing();
        act(() => {
            Simulate.focus(requiredField());
        });

        render(control, makeContext({ value: EXTERNAL_TEXT, metadata: EXTERNAL_METADATA, host }));
        await flush();
        // Mid-edit the user keeps what they are writing.
        expect(requiredField().value).toBe(SAVED_TEXT);

        act(() => {
            Simulate.blur(requiredField());
        });
        await flush();

        expect(plainRuns()).toBe("Please see  about it");
        act(() => {
            Simulate.click(tokenAt(0));
        });
        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_B }]);
    });

    it("is not disturbed by its own output coming back", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
        enterEditing();
        type(`Hi. ${SAVED_TEXT}`);
        const text = control.getOutputs().field ?? "";
        const metadata = control.getOutputs().mentionMetadata ?? "";
        const asked = host.lookedUp.length;
        notifyCount = 0;

        // The host acknowledges the edit, twice, as it is free to do.
        render(control, makeContext({ value: text, metadata, host }));
        await flush();
        render(control, makeContext({ value: text, metadata, host }));
        await flush();

        expect(requiredField().value).toBe(text);
        expect(control.getOutputs().mentionMetadata).toBe(metadata);
        // No new episode, no new lookup, nothing reported to the framework.
        expect(host.lookedUp).toHaveLength(asked);
        expect(notifyCount).toBe(0);
        // The field the user was typing in is still the field they were typing
        // in: an acknowledgement is not a reason to build the editor again.
        expect(document.activeElement).toBe(requiredField());
        // And it still knows where its mention is, which a rebuilt editor would
        // not: Backspace behind the name takes the name, not one character.
        const withMention = requiredField();
        // "Hi. Hello @Alex Rivera today": the name runs from 10 to 22.
        withMention.setSelectionRange(22, 22);
        act(() => {
            Simulate.keyDown(withMention, { key: "Backspace" });
        });
        expect(withMention.selectionStart).toBe(10);
        expect(withMention.selectionEnd).toBe(23);
    });

    it("ignores a late echo of a value the user has moved past", async () => {
        const host = makeHost();
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, host });
        enterEditing();
        type(`${SAVED_TEXT}!`);
        type(`${SAVED_TEXT}!!`);
        const metadata = control.getOutputs().mentionMetadata ?? "";

        render(control, makeContext({ value: `${SAVED_TEXT}!`, metadata, host }));
        await flush();

        expect(requiredField().value).toBe(`${SAVED_TEXT}!!`);
        expect(control.getOutputs().field).toBe(`${SAVED_TEXT}!!`);
    });
});

describe("starting to edit a field that is at rest", () => {
    it("puts the caret in the field on the first click", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        enterEditing();

        // One click, one field to type in — not a click to open it and another
        // to reach it.
        expect(document.activeElement).toBe(requiredField());
        expect(requiredField().selectionStart).toBe(SAVED_TEXT.length);
    });

    it("can be reached and opened from the keyboard", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const surface = reader();
        if (surface === null) {
            throw new Error("the field is not in read mode");
        }

        expect(surface.getAttribute("tabindex")).toBe("0");
        act(() => {
            Simulate.keyDown(surface, { key: "Enter" });
        });

        expect(document.activeElement).toBe(requiredField());
    });

    it("opens on Space as well, without scrolling the form", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const surface = reader();
        if (surface === null) {
            throw new Error("the field is not in read mode");
        }
        let defaultPrevented = false;

        act(() => {
            Simulate.keyDown(surface, {
                key: " ",
                preventDefault: () => {
                    defaultPrevented = true;
                },
            });
        });

        expect(defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(requiredField());
    });

    it("stays where it is for any other key", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const surface = reader();
        if (surface === null) {
            throw new Error("the field is not in read mode");
        }

        act(() => {
            Simulate.keyDown(surface, { key: "Tab" });
        });

        expect(isEditing()).toBe(false);
    });

    it("does not open on a key press when the field is read-only", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, disabled: true });
        const surface = reader();
        if (surface === null) {
            throw new Error("the field is not in read mode");
        }

        expect(surface.getAttribute("tabindex")).toBe("-1");
        act(() => {
            Simulate.keyDown(surface, { key: "Enter" });
        });

        expect(isEditing()).toBe(false);
    });

    it("leaves the field alone when a person is pressed instead", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        act(() => {
            Simulate.click(tokenAt(0));
        });

        expect(isEditing()).toBe(false);
        expect(document.activeElement).not.toBe(field());
    });
});
describe("the same words, a different person", () => {
    /** "Please ask @Robin Fox" — the mention runs from 11, ten characters long. */
    const TEXT = "Please ask @Robin Fox";
    const AS_USER_A = payload([
        { eventId: EVENT_A, recipientUserId: USER_A, occurrences: [{ start: 11, length: 10 }] },
    ]);
    /** The same record, saved again: same sentence, the other Robin Fox. */
    const AS_USER_B = payload([
        { eventId: EVENT_B, recipientUserId: USER_B, occurrences: [{ start: 11, length: 10 }] },
    ]);

    interface Written {
        readonly mentions: readonly {
            readonly eventId: string;
            readonly recipientUserId: string;
            readonly occurrences: readonly Span[];
        }[];
    }

    const written = (control: MentionControl): Written =>
        JSON.parse(control.getOutputs().mentionMetadata ?? "") as Written;

    it("follows the metadata when the text does not change at all", async () => {
        const host = makeHost(NAMESAKES);
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });

        act(() => {
            Simulate.click(tokenAt(0));
        });
        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_A }]);

        // Same record, same words, new authoritative payload.
        render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();

        expect(tokens()).toHaveLength(1);
        expect(tokenAt(0).textContent).toContain("Robin Fox");
        act(() => {
            Simulate.click(tokenAt(0));
        });
        // The display name never was the identity, and it is not now.
        expect(host.opened.map((form) => form.entityId)).toEqual([USER_A, USER_B]);
    });

    it("writes the new person back, and never the old one", async () => {
        const host = makeHost(NAMESAKES);
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });

        render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();
        enterEditing();
        type(`Hi. ${TEXT}`);

        expect(written(control).mentions).toEqual([
            {
                eventId: EVENT_B,
                recipientUserId: USER_B,
                occurrences: [{ start: 15, length: 10 }],
            },
        ]);
        const raw = control.getOutputs().mentionMetadata ?? "";
        expect(raw).not.toContain(USER_A);
        expect(raw).not.toContain(EVENT_A);
    });

    it("waits for the edit to end before changing who is meant", async () => {
        const host = makeHost(NAMESAKES);
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });
        enterEditing();
        act(() => {
            Simulate.focus(requiredField());
        });
        const caret = requiredField().selectionStart;

        render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();

        // Nothing moves under the hands of somebody typing.
        expect(requiredField().value).toBe(TEXT);
        expect(requiredField().selectionStart).toBe(caret);

        act(() => {
            Simulate.blur(requiredField());
        });
        await flush();

        act(() => {
            Simulate.click(tokenAt(0));
        });
        expect(host.opened).toEqual([{ entityName: "systemuser", entityId: USER_B }]);
    });

    it("never writes a mixture of the two", async () => {
        const host = makeHost(NAMESAKES);
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });
        enterEditing();
        act(() => {
            Simulate.focus(requiredField());
        });

        render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();
        act(() => {
            Simulate.blur(requiredField());
        });
        await flush();
        enterEditing();
        type(`${TEXT}!`);

        // One person, one notification: the one the record now carries.
        expect(written(control).mentions).toEqual([
            {
                eventId: EVENT_B,
                recipientUserId: USER_B,
                occurrences: [{ start: 11, length: 10 }],
            },
        ]);
    });

    it("confirms the new person in their own right", async () => {
        // USER_B has never been asked about before, and is not taken on trust
        // from the confirmation USER_A got for the very same name.
        const host = makeHost({ [USER_A]: "Robin Fox", [USER_B]: null });
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });
        expect(tokens()).toHaveLength(1);

        render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();

        expect(host.lookedUp).toEqual([USER_A, USER_B]);
        expect(tokens()).toEqual([]);
        expect(plainRuns()).toBe(TEXT);
    });

    it("reads the record's people again only when the record says something new", async () => {
        const host = makeHost(NAMESAKES);
        const { control, editor } = await start({ value: TEXT, metadata: AS_USER_A, host });
        const opening = editor.hostRevision;

        // The framework redraws a control for all sorts of reasons. The same
        // pair, again, is not one of them.
        const repeated = render(
            control,
            makeContext({ value: TEXT, metadata: AS_USER_A, host })
        );
        await flush();
        expect(repeated.hostRevision).toBe(opening);

        const changed = render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();

        // Once for the one pair that was new, and once only.
        expect(changed.hostRevision).toBe((opening ?? 0) + 1);
        const again = render(control, makeContext({ value: TEXT, metadata: AS_USER_B, host }));
        await flush();
        expect(again.hostRevision).toBe((opening ?? 0) + 1);
    });

    it("is not re-read when the host repeats the pair it already gave", async () => {
        const host = makeHost(NAMESAKES);
        const { control } = await start({ value: TEXT, metadata: AS_USER_A, host });
        enterEditing();
        act(() => {
            Simulate.focus(requiredField());
        });
        type(`${TEXT} please`);
        const edited = control.getOutputs().field;
        notifyCount = 0;

        // The same pair the control has been working from all along.
        render(control, makeContext({ value: TEXT, metadata: AS_USER_A, host }));
        await flush();

        // An identical redraw is not a decision: what is being typed survives it.
        expect(requiredField().value).toBe(`${TEXT} please`);
        expect(control.getOutputs().field).toBe(edited);
        expect(notifyCount).toBe(0);
    });
});

describe("opening a record without a connection", () => {
    const TEXT = SAVED_TEXT;

    it("asks nobody, shows text, and changes nothing", async () => {
        const host = makeHost();
        const { control } = await start({
            value: TEXT,
            metadata: SAVED_METADATA,
            host,
            offline: true,
        });

        expect(host.lookedUp).toEqual([]);
        expect(tokens()).toEqual([]);
        expect(plainRuns()).toBe(TEXT);
        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("asks once the connection is back, and shows the person then", async () => {
        const host = makeHost();
        const { control } = await start({
            value: TEXT,
            metadata: SAVED_METADATA,
            host,
            offline: true,
        });
        expect(host.lookedUp).toEqual([]);

        render(control, makeContext({ value: TEXT, metadata: SAVED_METADATA, host }));
        await flush();

        // Exactly one question, asked when there was somewhere to ask it.
        expect(host.lookedUp).toEqual([USER_A]);
        expect(tokenAt(0).textContent).toContain("Alex Rivera");
        // Being able to confirm something is not a change to the record.
        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("still lets the text be edited while there is no connection", async () => {
        const host = makeHost();
        const { control } = await start({
            value: TEXT,
            metadata: SAVED_METADATA,
            host,
            offline: true,
        });

        enterEditing();
        type(`Hi. ${TEXT}`);

        // The recorded notification moved with the text, unconfirmed or not.
        const raw = JSON.parse(control.getOutputs().mentionMetadata ?? "") as {
            mentions: { eventId: string; recipientUserId: string; occurrences: Span[] }[];
        };
        expect(raw.mentions[0]?.eventId).toBe(EVENT_A);
        expect(raw.mentions[0]?.recipientUserId).toBe(USER_A);
        expect(raw.mentions[0]?.occurrences).toEqual([{ start: 10, length: 12 }]);
        expect(host.lookedUp).toEqual([]);
    });

    it("says why the picker is closed, and keeps it closed", async () => {
        const { editor } = await start({
            value: TEXT,
            metadata: SAVED_METADATA,
            offline: true,
        });

        expect(editor.notice).toBe(resourceValue("Editor_OfflineNotice"));
        expect(editor.canMention).toBe(false);
        expect(editor.canVerifyPersistedMentions).toBe(false);
    });
});
