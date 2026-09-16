import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { AyontoMentionControl } from "../MentionControl/index";
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
 * that the configured number survives the trip — clamped, defaulted, and set on
 * the textarea, which is the one box this field has — and that the read view
 * overlays that box instead of becoming a second one with a height of its own.
 *
 * That is the whole claim. These tests do not show what the field looks like, or
 * that it never jumps when it changes between reading and writing: jsdom lays
 * nothing out, so every box it is asked about is zero, and a test asserting
 * rendered heights here would assert jsdom's zeros rather than anything about
 * Power Apps. The rendered result belongs to a browser and is on the checklist
 * for the DEV environment.
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
    control: AyontoMentionControl,
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
    control: AyontoMentionControl;
    editor: MentionEditorProps;
}> {
    const control = new AyontoMentionControl();
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

const reader = (): HTMLElement | null => container.querySelector('[role="group"]');

function requiredSurface(): HTMLElement {
    const element = reader();
    if (element === null) {
        throw new Error("the field is not showing its people view");
    }
    return element;
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

        // The minimum is a floor, not a fixed height: nothing here pins the
        // field's height or takes Fluent's vertical resize handle away.
        expect(requiredField().style.height).toBe("");
        expect(requiredField().style.maxHeight).toBe("");
    });
});

describe("reading and writing are one box", () => {
    it("keeps the field itself while the people view is shown", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 4 });

        // The read view does not replace the field; it covers it. The minimum —
        // and whatever height the field has been given since — belongs to the
        // one element underneath, which is still there.
        const surface = reader();
        expect(surface).not.toBeNull();
        expect(requiredField().style.minHeight).toContain("4 *");
        expect(window.getComputedStyle(requiredSurface()).position).toBe("absolute");

        act(() => {
            if (surface !== null) {
                Simulate.click(surface);
            }
        });

        // Editing the same box, not a different one.
        expect(requiredField().style.minHeight).toContain("4 *");
    });

    it("measures a row of text the same way on both", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 3 });

        const surface = reader();
        expect(surface).not.toBeNull();
        const reading = surface === null ? null : window.getComputedStyle(surface);

        // The values Fluent's own Textarea uses at its default `medium` size, so
        // that "a row" costs the same on the surface that shows the text and in
        // the field that edits it. Asserted as the tokens they are: the numbers
        // behind them belong to the theme, and the box they add up to belongs to
        // a browser.
        expect(reading?.fontSize).toBe("var(--fontSizeBase300)");
        expect(reading?.lineHeight).toBe("var(--lineHeightBase300)");
        expect(reading?.getPropertyValue("padding-block")).toBe("var(--spacingVerticalSNudge)");
        expect(reading?.getPropertyValue("padding-inline")).toBe(
            "calc(var(--spacingHorizontalMNudge) + var(--spacingHorizontalXXS))"
        );
        // The overlay is pinned to the textarea's box rather than asked to work
        // one out, and it counts its padding inside that box the way Fluent's
        // textarea counts its own — the same box model, deliberately.
        expect(reading?.boxSizing).toBe("border-box");
    });

    it("follows the row count while the people view is up", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 2 });
        expect(requiredField().style.minHeight).toContain("2 *");

        render(
            control,
            makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA, minRows: 6 })
        );
        await flush();

        expect(reader()).not.toBeNull();
        expect(requiredField().style.minHeight).toContain("6 *");
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
        expect(isEditing()).toBe(false);
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

describe("a height the user gave the field", () => {
    it("survives the trip through the people view", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        // Into editing, and hold on to the actual element.
        const surface = reader();
        act(() => {
            if (surface !== null) {
                Simulate.click(surface);
            }
        });
        const editor = requiredField();

        // Standing in for a height the browser owns: dragging the resize handle
        // writes exactly this, on exactly this element. jsdom cannot perform the
        // drag, and this test does not pretend it can — what it checks is that
        // the thing the browser wrote on is still the thing that comes back.
        editor.style.height = "180px";

        act(() => {
            Simulate.blur(editor);
        });
        await flush();

        expect(reader()).not.toBeNull();
        const whileReading = field();
        expect(whileReading).not.toBeNull();
        expect(whileReading).toBe(editor);
        expect(whileReading?.style.height).toBe("180px");

        // And back into editing: still the same element, still that height.
        const back = reader();
        act(() => {
            if (back !== null) {
                Simulate.click(back);
            }
        });

        expect(requiredField()).toBe(editor);
        expect(requiredField().style.height).toBe("180px");
        // Nothing about any of this is an edit.
        expect(notifyCount).toBe(0);
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
    });

    it("is not rebuilt when the value comes back from the host unchanged", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const first = field();
        expect(first).not.toBeNull();

        render(control, makeContext({ value: SAVED_TEXT, metadata: SAVED_METADATA }));
        await flush();

        expect(field()).toBe(first);
    });
});

describe("what the people view leaves reachable", () => {
    it("offers the reader, and not a second field behind it", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        const surface = requiredSurface();
        // One thing to reach: the reader. The field underneath is covered, taken
        // out of the tab order and hidden from assistive technology, so the value
        // is not offered twice.
        expect(surface.getAttribute("tabindex")).toBe("0");
        expect(requiredField().getAttribute("aria-hidden")).toBe("true");
        expect(requiredField().tabIndex).toBe(-1);
    });

    it("still opens the person a token names, without starting an edit", async () => {
        const { control } = await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });

        const token = container.querySelector("button");
        expect(token?.textContent).toContain("Alex Rivera");
        act(() => {
            if (token !== null) {
                Simulate.click(token);
            }
        });

        expect(isEditing()).toBe(false);
        expect(reader()).not.toBeNull();
        expect(control.getOutputs().field).toBe(SAVED_TEXT);
    });

    it("puts the caret in the very field it was covering", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA });
        const covered = field();

        const surface = requiredSurface();
        act(() => {
            Simulate.keyDown(surface, { key: "Enter" });
        });

        // The element that was hidden is the element now being typed in.
        expect(document.activeElement).toBe(covered);
        expect(requiredField().getAttribute("aria-hidden")).toBeNull();
        expect(requiredField().tabIndex).not.toBe(-1);
        expect(reader()).toBeNull();
    });

    it("keeps a read-only field out of editing, covered field and all", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, disabled: true });

        const surface = requiredSurface();
        expect(surface.getAttribute("tabindex")).toBe("-1");
        act(() => {
            Simulate.keyDown(surface, { key: "Enter" });
        });
        act(() => {
            Simulate.click(surface);
        });

        expect(isEditing()).toBe(false);
        expect(requiredField().disabled).toBe(true);
    });

    it("puts nothing of an unreadable column into the page, field included", async () => {
        await start({ value: SAVED_TEXT, metadata: SAVED_METADATA, readable: false });

        // Masking is the one case where the field really is gone: a hidden
        // textarea would still be carrying the value it is meant to withhold.
        expect(field()).toBeNull();
        expect(reader()).toBeNull();
        expect(container.innerHTML).not.toContain("Alex Rivera");
        expect(container.innerHTML).not.toContain("Hello @");
    });
});
