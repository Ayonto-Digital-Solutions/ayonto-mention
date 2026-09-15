import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs } from "../MentionControl/generated/ManifestTypes";
import { MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import { DEFAULT_FIELD_ROWS } from "../src/domain/fieldRows";
import { resourceValue } from "./support/resources";

/**
 * How tall the field is before anybody types in it.
 *
 * A model-driven form does not tell a code component how tall the maker drew the
 * field, so the maker configures a row count instead. What is checked here is
 * that the configured number survives the trip — clamped, defaulted, and given
 * to the field and to the read surface as one and the same minimum. What is
 * deliberately *not* checked is how many pixels that turns into: jsdom lays
 * nothing out, and a test asserting rendered heights here would only be
 * asserting that jsdom returns zero.
 */

const RECORD_A = "aaaaaaaa-1111-2222-3333-444444444444";
const EVENT_A = "11111111-2222-4333-8444-555555555555";
const USER_A = "aaaaaaaa-0000-1111-2222-333333333333";

/** "Hello @Alex Rivera today", with Alex recorded as a mention. */
const SAVED_TEXT = "Hello @Alex Rivera today";
const SAVED_METADATA = JSON.stringify({
    schemaVersion: 1,
    sourceField: "description",
    mentions: [
        {
            eventId: EVENT_A,
            recipientUserId: USER_A,
            occurrences: [{ start: 6, length: 12 }],
        },
    ],
});

interface HostOptions {
    readonly value?: string;
    readonly metadata?: string;
    readonly minRows?: unknown;
    readonly omitMinRows?: boolean;
    readonly readable?: boolean;
    readonly disabled?: boolean;
    readonly offline?: boolean;
}

let container: HTMLDivElement;
let notifyCount = 0;

function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    const parameters: Record<string, unknown> = {
        field: {
            raw: options.value ?? "",
            attributes: { LogicalName: "description" },
            security:
                options.readable === undefined
                    ? undefined
                    : { editable: true, readable: options.readable, secured: true },
        },
        recordId: { raw: RECORD_A },
        recordTable: { raw: "account" },
        mentionMetadata: { raw: options.metadata ?? "" },
    };
    // A form configured before this property existed passes no entry at all.
    if (options.omitMinRows !== true) {
        parameters.minRows = { raw: options.minRows ?? null };
    }

    return {
        parameters,
        mode: { isControlDisabled: options.disabled ?? false, label: "Comment" },
        client: {
            disableScroll: false,
            getClient: () => "Web",
            getFormFactor: () => 1,
            isOffline: () => options.offline ?? false,
            isNetworkAvailable: () => !(options.offline ?? false),
        },
        navigation: {
            openForm: jest.fn(() => Promise.resolve({ savedEntityReference: [] })),
        },
        resources: { getString: (id: string) => resourceValue(id) },
        formatting: { formatInteger: (value: number) => value.toString() },
        webAPI: {
            retrieveMultipleRecords: jest.fn(() => Promise.resolve({ entities: [], nextLink: "" })),
            retrieveRecord: jest.fn(() =>
                Promise.resolve({ systemuserid: USER_A, fullname: "Alex Rivera" })
            ),
        },
    } as unknown as ComponentFramework.Context<IInputs>;
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

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

const field = (): HTMLTextAreaElement | null => container.querySelector("textarea");

function requiredField(): HTMLTextAreaElement {
    const element = field();
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

const reader = (): HTMLElement | null => container.querySelector('[role="group"]');

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

describe("how tall the field starts out", () => {
    it("asks for three rows when the maker configured nothing", async () => {
        const { editor } = await start();

        expect(editor.minRows).toBe(DEFAULT_FIELD_ROWS);
        expect(requiredField().rows).toBe(3);
    });

    it("asks for three rows when the form has no such property at all", async () => {
        // A form configured before the property existed. The control was updated;
        // the form was not, and it must keep working exactly as it did.
        const { editor } = await start({ omitMinRows: true });

        expect(editor.minRows).toBe(3);
        expect(requiredField().rows).toBe(3);
    });

    it("takes the row count the maker configured", async () => {
        for (const rows of [1, 3, 5, 30]) {
            const { editor } = await start({ minRows: rows });

            expect(editor.minRows).toBe(rows);
            expect(requiredField().rows).toBe(rows);
            act(() => {
                ReactDOM.unmountComponentAtNode(container);
            });
        }
    });

    it("keeps a configured row count inside what a form can carry", async () => {
        const tooSmall = await start({ minRows: 0 });
        expect(tooSmall.editor.minRows).toBe(1);
        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });

        const tooLarge = await start({ minRows: 90 });
        expect(tooLarge.editor.minRows).toBe(30);
    });

    it("falls back rather than fail on a value it cannot use", async () => {
        for (const unusable of [Number.NaN, "5", {}]) {
            const { editor } = await start({ minRows: unusable });

            expect(editor.minRows).toBe(3);
            act(() => {
                ReactDOM.unmountComponentAtNode(container);
            });
        }
    });

    it("gives the field a minimum height built from the row count", async () => {
        await start({ minRows: 5 });

        // Written out of the theme's own type scale rather than a pixel count, so
        // it still means five rows when the theme or the browser zoom changes it.
        const minHeight = requiredField().style.minHeight;
        expect(minHeight).toContain("5 *");
        expect(minHeight).toContain("lineHeightBase300");
        expect(minHeight).toContain("spacingVerticalSNudge");
    });

    it("leaves the field resizable by hand", async () => {
        await start({ minRows: 3 });

        // The minimum is a floor, not a fixed height: Fluent's vertical resize
        // handle is untouched, and the field still grows with its content.
        expect(requiredField().style.height).toBe("");
        expect(requiredField().style.maxHeight).toBe("");
    });
});

describe("reading and writing are the same height", () => {
    it("gives the read surface the very same minimum", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 4 });

        const surface = reader();
        expect(surface).not.toBeNull();
        const reading = surface === null ? "" : surface.style.minHeight;
        expect(reading).toContain("4 *");

        // One click puts the same field into editing. The two minimums are one
        // string: a field that changed height on the way would move the form.
        act(() => {
            if (surface !== null) {
                Simulate.click(surface);
            }
        });

        expect(requiredField().style.minHeight).toBe(reading);
    });

    it("keeps the same minimum when the row count changes", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 2 });
        expect(reader()?.style.minHeight).toContain("2 *");

        render(
            control,
            makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 6 })
        );
        await flush();

        expect(reader()?.style.minHeight).toContain("6 *");
    });
});

describe("what a height is not allowed to change", () => {
    it("says nothing to the host merely for being drawn", async () => {
        const { control } = await start({
            value: SAVED_TEXT,
            metadata: SAVED_METADATA,
            minRows: 12,
        });

        // Rendering a field of any height is not an edit.
        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("emits nothing when only the row count changes", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        notifyCount = 0;

        render(
            control,
            makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 9 })
        );
        await flush();

        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("still shows nothing of an unreadable column, whatever its height", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 8, readable: false });

        expect(field()).toBeNull();
        expect(container.textContent).not.toContain("Alex Rivera");
        expect(container.innerHTML).not.toContain("Alex Rivera");
        expect(container.textContent).toContain(resourceValue("Editor_MaskedValue"));
    });

    it("still keeps a read-only field read-only", async () => {
        await start({
            value: SAVED_TEXT,
            metadata: SAVED_METADATA,
            minRows: 8,
            disabled: true,
        });

        const surface = reader();
        expect(surface).not.toBeNull();
        act(() => {
            if (surface !== null) {
                Simulate.click(surface);
            }
        });
        expect(field()).toBeNull();
    });

    it("still shows saved mentions as people, at any height", async () => {
        const { control } = await start({
            value: SAVED_TEXT,
            metadata: SAVED_METADATA,
            minRows: 1,
        });

        const tokens = container.querySelectorAll("button");
        expect(tokens).toHaveLength(1);
        expect(tokens[0]?.textContent).toContain("Alex Rivera");
        expect(control.getOutputs().mentionMetadata).toBe(SAVED_METADATA);
    });

    it("still says why mentioning is off with no connection", async () => {
        const { editor } = await start({ minRows: 5, offline: true });

        expect(editor.minRows).toBe(5);
        expect(editor.canMention).toBe(false);
        expect(editor.notice).toBe(resourceValue("Editor_OfflineNotice"));
    });
});

describe("two fields on one form", () => {
    it("each keeps the height it was configured with", () => {
        const second = document.createElement("div");
        document.body.appendChild(second);

        const props = (minRows: number): MentionEditorProps => ({
            value: "",
            disabled: false,
            label: "Comment",
            minRows,
            userSearchProvider: { search: () => Promise.resolve({ users: [], hasMore: false }) },
            onLocalEdit: () => undefined,
        });

        act(() => {
            ReactDOM.render(<MentionEditor {...props(2)} />, container);
            ReactDOM.render(<MentionEditor {...props(7)} />, second);
        });

        expect(requiredField().rows).toBe(2);
        expect(second.querySelector("textarea")?.rows).toBe(7);
        expect(requiredField().style.minHeight).toContain("2 *");
        expect(second.querySelector("textarea")?.style.minHeight).toContain("7 *");

        act(() => {
            ReactDOM.unmountComponentAtNode(second);
        });
        second.remove();
    });
});
