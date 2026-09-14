import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionControl } from "../MentionControl/index";
import type { IInputs } from "../MentionControl/generated/ManifestTypes";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import type { MentionRecordContext } from "../src/domain/recordContext";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";

interface HostOptions {
    readonly value?: string | null;
    readonly disabled?: boolean;
    readonly editable?: boolean;
    readonly maxLength?: number;
    readonly label?: string;
    readonly webApi?: ComponentFramework.WebApi;
    readonly recordId?: string | null;
    readonly recordTable?: string | null;
    /** Logical name of the bound column, as the field metadata reports it. */
    readonly logicalName?: string | null;
    /** Omits the field metadata entirely, as a host may do. */
    readonly withoutAttributes?: boolean;
    /** What the host holds in the companion column. */
    readonly metadata?: string;
    /** Set when the host states whether the companion column may be written. */
    readonly metadataEditable?: boolean;
}

/** Records every Web API call the control makes. */
interface RecordedCall {
    readonly entity: string;
    readonly options: string;
}

function makeWebApi(recorded: RecordedCall[] = []): ComponentFramework.WebApi {
    return {
        retrieveMultipleRecords: jest.fn((entity: string, options?: string) => {
            recorded.push({ entity, options: options ?? "" });
            return Promise.resolve({ entities: [], nextLink: "" });
        }),
    } as unknown as ComponentFramework.WebApi;
}

/** A host context. Every value is fictional. */
function makeContext(options: HostOptions = {}): ComponentFramework.Context<IInputs> {
    return {
        parameters: {
            field: {
                raw: options.value === undefined ? "" : options.value,
                // A host normally reports the bound column's metadata, but it is
                // optional in the framework's own typings.
                attributes:
                    options.withoutAttributes === true
                        ? undefined
                        : {
                              MaxLength: options.maxLength,
                              LogicalName:
                                  options.logicalName === undefined
                                      ? "description"
                                      : options.logicalName,
                          },
                security:
                    options.editable === undefined
                        ? undefined
                        : { editable: options.editable, readable: true, secured: false },
            },
            recordId: { raw: options.recordId === undefined ? "" : options.recordId },
            recordTable: {
                raw: options.recordTable === undefined ? "account" : options.recordTable,
            },
            mentionMetadata: {
                raw: options.metadata ?? "",
                security:
                    options.metadataEditable === undefined
                        ? undefined
                        : { editable: options.metadataEditable, readable: true, secured: false },
            },
        },
        mode: {
            isControlDisabled: options.disabled ?? false,
            label: options.label ?? "Comment",
        },
        webAPI: options.webApi ?? makeWebApi(),
    } as unknown as ComponentFramework.Context<IInputs>;
}

let container: HTMLDivElement;
let notifyCount = 0;

/** jsdom implements no scrollIntoView, and SuggestionList uses it. */
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function start(options: HostOptions = {}): {
    control: MentionControl;
    context: ComponentFramework.Context<IInputs>;
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
    render(control, context);
    return { control, context };
}

function render(control: MentionControl, context: ComponentFramework.Context<IInputs>): void {
    act(() => {
        ReactDOM.render(control.updateView(context), container);
    });
}

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

/** Replaces the text as a keystroke would, leaving the caret at the end. */
function type(next: string): void {
    const element = field();
    act(() => {
        element.value = next;
        element.setSelectionRange(next.length, next.length);
        Simulate.change(element);
    });
}

/** Really focuses the textarea, so the editor treats what follows as editing. */
function focusField(): void {
    act(() => {
        Simulate.focus(field());
    });
}

function blurField(): void {
    act(() => {
        Simulate.blur(field());
    });
}

function advance(ms: number = MENTION_SEARCH_DEBOUNCE_MS): void {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

/**
 * TEST ONLY. Reads the adapter's private record context.
 *
 * `private` is a compile-time notion, so the field is there at runtime. Reaching
 * it through a cast confined to this file keeps the production class API to the
 * four framework lifecycle methods: the control exposes no accessor that exists
 * only so a test can look inside, and the persistence step will read the field
 * directly from within the class.
 */
function recordContextOf(control: MentionControl): MentionRecordContext | null {
    return (control as unknown as { recordContext: MentionRecordContext | null }).recordContext;
}

/** Reads the props the adapter hands to the editor, without rendering them. */
function editorProps(
    control: MentionControl,
    context: ComponentFramework.Context<IInputs>
): MentionEditorProps {
    return control.updateView(context).props as MentionEditorProps;
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

describe("MentionControl adapter", () => {
    it("renders the bound value it was initialized with", () => {
        start({ value: "Hello from the host" });

        expect(field().value).toBe("Hello from the host");
    });

    it("treats an empty bound column as an empty string", () => {
        const { control } = start({ value: null });

        expect(field().value).toBe("");
        expect(control.getOutputs().field).toBe("");
    });

    it("returns a React element from updateView", () => {
        const { control, context } = start();

        expect(React.isValidElement(control.updateView(context))).toBe(true);
    });

    it("never notifies the framework just for rendering", () => {
        const { control, context } = start({ value: "A" });

        render(control, context);
        render(control, context);
        render(control, makeContext({ value: "B" }));

        expect(notifyCount).toBe(0);
    });

    it("notifies the framework exactly once for a local edit", () => {
        start({ value: "A" });

        type("AB");

        expect(notifyCount).toBe(1);
    });

    it("reports the edited value as its output", () => {
        const { control } = start({ value: "A" });

        type("AB");

        expect(control.getOutputs().field).toBe("AB");
    });

    it("does not let a stale host echo revert the local edit", () => {
        const { control } = start({ value: "A" });
        type("AB");

        // The host has not caught up yet and still reports the old value.
        render(control, makeContext({ value: "A" }));

        expect(control.getOutputs().field).toBe("AB");
        expect(field().value).toBe("AB");
    });

    it("treats the host reporting the local value as an acknowledgement", () => {
        const { control } = start({ value: "A" });
        type("AB");

        render(control, makeContext({ value: "AB" }));

        expect(control.getOutputs().field).toBe("AB");
        expect(field().value).toBe("AB");
    });

    it("accepts a previously used value again once the edit was acknowledged", () => {
        const { control } = start({ value: "A" });
        type("AB");
        // A real acknowledgement reports the whole output back, both columns.
        render(
            control,
            makeContext({ value: "AB", metadata: control.getOutputs().mentionMetadata ?? "" })
        );

        // "A" was the value before the edit, but nothing is outstanding any more,
        // so this is the host deciding, not an echo.
        render(control, makeContext({ value: "A" }));

        expect(control.getOutputs().field).toBe("A");
        expect(field().value).toBe("A");
    });

    it("ignores a host report of an earlier output while a newer one is pending", () => {
        // A -> AB -> ABC, and the host is still two keystrokes behind.
        const { control } = start({ value: "A" });
        type("AB");
        type("ABC");

        render(control, makeContext({ value: "AB" }));

        expect(field().value).toBe("ABC");
        expect(control.getOutputs().field).toBe("ABC");
    });

    it("keeps the edit outstanding after ignoring an earlier output echo", () => {
        const { control } = start({ value: "A" });
        type("AB");
        type("ABC");
        render(control, makeContext({ value: "AB" }));

        // Still waiting: the acknowledgement of the current output still lands.
        render(control, makeContext({ value: "ABC" }));

        expect(control.getOutputs().field).toBe("ABC");
        expect(field().value).toBe("ABC");
    });

    it("accepts an earlier output as a genuine host value once the cycle closed", () => {
        const { control } = start({ value: "A" });
        type("AB");
        type("ABC");
        render(
            control,
            makeContext({ value: "ABC", metadata: control.getOutputs().mentionMetadata ?? "" })
        );

        // The cycle is closed, so "AB" is the host deciding, not a late echo.
        render(control, makeContext({ value: "AB" }));

        expect(control.getOutputs().field).toBe("AB");
        expect(field().value).toBe("AB");
    });

    it("acknowledges an output that happens to equal the value the cycle started from", () => {
        // A -> AB -> back to A. The host reporting "A" acknowledges the current
        // output; reading it as the pre-edit baseline would leave the control
        // waiting for an acknowledgement that already arrived.
        const { control } = start({ value: "A" });
        type("AB");
        type("A");

        render(control, makeContext({ value: "A" }));
        expect(control.getOutputs().field).toBe("A");

        // The cycle closed, so an ordinary host value applies again at once.
        render(control, makeContext({ value: "Set elsewhere" }));

        expect(control.getOutputs().field).toBe("Set elsewhere");
        expect(field().value).toBe("Set elsewhere");
    });

    it("adopts a genuinely different host value while an edit is outstanding", () => {
        const { control } = start({ value: "A" });
        type("AB");

        // Neither the outstanding edit nor the value it replaced: a business rule
        // or another control decided this.
        render(control, makeContext({ value: "Set elsewhere" }));

        expect(control.getOutputs().field).toBe("Set elsewhere");
        expect(field().value).toBe("Set elsewhere");
    });

    it("keeps a newer local edit ahead of an older host value", () => {
        const { control } = start({ value: "A" });
        type("AB");
        render(control, makeContext({ value: "A" }));

        // Editing carries on while the host is still behind.
        type("ABC");
        render(control, makeContext({ value: "A" }));

        expect(control.getOutputs().field).toBe("ABC");
        expect(field().value).toBe("ABC");
        expect(notifyCount).toBe(2);
    });

    it("disables the editor when the host disables the control", () => {
        start({ value: "A", disabled: true });

        expect(field().disabled).toBe(true);
    });

    it("disables the editor for a column the user may not write to", () => {
        start({ value: "A", editable: false });

        expect(field().disabled).toBe(true);
    });

    it("passes the column length limit on to the editor", () => {
        start({ value: "A", maxLength: 250 });

        expect(field().getAttribute("maxlength")).toBe("250");
    });

    it("uses the host label as the accessible name", () => {
        start({ value: "A", label: "Internal note" });

        expect(field().getAttribute("aria-label")).toBe("Internal note");
    });

    it("falls back to a neutral name when the host label is empty", () => {
        start({ value: "A", label: "   " });

        expect(field().getAttribute("aria-label")).toBe("Ayonto Mention");
    });

    it("gives two controls on one form different listbox ids", () => {
        const first = new MentionControl();
        const second = new MentionControl();
        const context = makeContext({ value: "A" });
        first.init(context, () => undefined, {});
        second.init(context, () => undefined, {});

        const firstId = editorProps(first, context).listboxId;
        const secondId = editorProps(second, context).listboxId;

        expect(firstId).toBeDefined();
        expect(secondId).toBeDefined();
        expect(firstId).not.toBe(secondId);
    });

    it("keeps the same listbox id across renders of one control", () => {
        const { control, context } = start({ value: "A" });

        expect(editorProps(control, context).listboxId).toBe(
            editorProps(control, context).listboxId
        );
    });

    it("looks people up through the Web API the host supplied", () => {
        const recorded: RecordedCall[] = [];
        start({ value: "", webApi: makeWebApi(recorded) });

        type("@Da");
        advance();

        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.entity).toBe("systemuser");
        expect(recorded[0]?.options).toContain("contains(fullname,'Da')");
        expect(recorded[0]?.options).toContain("isdisabled eq false");
    });

    it("protects real editing from a host value and lets a newer edit supersede it", () => {
        const { control } = start({ value: "A" });

        // Genuinely focused: Simulate.change alone does not make the editor treat
        // the field as being edited.
        focusField();
        type("AB");
        expect(control.getOutputs().field).toBe("AB");

        // An external decision arrives mid-edit. The adapter accepts it, but the
        // editor must not pull it out from under the caret.
        render(control, makeContext({ value: "Set elsewhere" }));
        expect(field().value).toBe("AB");

        // The user types on, which supersedes the queued host value.
        type("ABX");
        blurField();
        render(control, makeContext({ value: "Set elsewhere" }));

        expect(field().value).toBe("ABX");
        expect(control.getOutputs().field).toBe("ABX");

        // The host catches up with the value actually typed.
        render(control, makeContext({ value: "ABX" }));

        expect(field().value).toBe("ABX");
        expect(control.getOutputs().field).toBe("ABX");
    });

    it("can be destroyed after initialization", () => {
        const { control } = start({ value: "A" });

        expect(() => {
            control.destroy();
        }).not.toThrow();
    });
});

describe("MentionControl record context", () => {
    const GUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    it("resolves a configured record into a normalized context", () => {
        const { control } = start({
            recordId: `{${GUID.toUpperCase()}}`,
            recordTable: "Account",
            logicalName: "Description",
        });

        expect(recordContextOf(control)).toEqual({
            recordId: GUID,
            recordTable: "account",
            sourceField: "description",
        });
    });

    it("takes the column name from the bound field metadata", () => {
        const { control } = start({
            recordId: GUID,
            recordTable: "contact",
            logicalName: "ayonto_comment",
        });

        expect(recordContextOf(control)?.sourceField).toBe("ayonto_comment");
    });

    it("reports no context, without failing, while the record has no id", () => {
        // A form for a record Dataverse has not saved yet.
        const { control } = start({ value: "A", recordId: "" });

        expect(recordContextOf(control)).toBeNull();
        expect(field().value).toBe("A");
    });

    it("copes with a host that reports no field metadata at all", () => {
        const { control } = start({ value: "A", recordId: GUID, withoutAttributes: true });

        // No column name to anchor a mention to, and no length limit to apply.
        expect(recordContextOf(control)).toBeNull();
        expect(field().getAttribute("maxlength")).toBeNull();
        expect(field().value).toBe("A");
    });

    it("reports no context when the column metadata is unavailable", () => {
        const { control } = start({ recordId: GUID, logicalName: null });

        expect(recordContextOf(control)).toBeNull();
    });

    it("reports no context without a configured table", () => {
        const { control } = start({ recordId: GUID, recordTable: "" });

        expect(recordContextOf(control)).toBeNull();
    });

    it("recognises a record id that only appears on a later update", () => {
        // The record is saved while the form is open, and the host starts
        // reporting its id.
        const { control } = start({ recordId: "" });
        expect(recordContextOf(control)).toBeNull();

        render(control, makeContext({ recordId: `{${GUID.toUpperCase()}}` }));

        expect(recordContextOf(control)).toEqual({
            recordId: GUID,
            recordTable: "account",
            sourceField: "description",
        });
    });

    it("follows a change of the configured table", () => {
        const { control } = start({ recordId: GUID, recordTable: "account" });
        expect(recordContextOf(control)?.recordTable).toBe("account");

        render(control, makeContext({ recordId: GUID, recordTable: "Contact" }));

        expect(recordContextOf(control)?.recordTable).toBe("contact");
    });

    it("does not notify the framework for a record-context change", () => {
        const { control } = start({ recordId: "" });

        render(control, makeContext({ recordId: GUID }));
        render(control, makeContext({ recordId: GUID, recordTable: "contact" }));

        expect(recordContextOf(control)).not.toBeNull();
        expect(notifyCount).toBe(0);
    });

    it("does not call the Web API merely to resolve a record context", () => {
        const recorded: RecordedCall[] = [];
        const { control } = start({ recordId: GUID, webApi: makeWebApi(recorded) });

        render(control, makeContext({ recordId: GUID, recordTable: "contact" }));
        advance();

        expect(recordContextOf(control)).not.toBeNull();
        expect(recorded).toEqual([]);
    });
});
