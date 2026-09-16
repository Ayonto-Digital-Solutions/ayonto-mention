import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";
import { computePosition } from "@floating-ui/dom";

import { MENTION_POPUP_POSITIONING, MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import type {
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../src/domain/userSearch";

/**
 * What this file is about: the suggestions are drawn against the field rather
 * than after it in the document, and that must not cost the editor anything it
 * already had — the caret, the keyboard, the names the textarea points at, or
 * the silence towards the host.
 *
 * What it deliberately does not do is claim to prove where a popup lands on a
 * screen. jsdom lays nothing out, so every element it is asked about is zero by
 * zero at the origin, and "it flipped above because there was no room below"
 * cannot be true or false here. What *can* be checked is the contract handed to
 * the positioning engine, and that the element it positions against is the
 * field itself.
 */

/** Fictional people. */
const dana: UserSuggestion = { id: "u-dana", name: "Dana", jobTitle: "Support Lead" };
const danaWinter: UserSuggestion = { id: "u-dana-winter", name: "Dana Winter" };

interface Controllable {
    readonly provider: UserSearchProvider;
    settle(index: number, value: UserSearchResult): Promise<void>;
}

function controllableProvider(): Controllable {
    const settlers: ((value: UserSearchResult) => void)[] = [];

    return {
        provider: {
            search: () =>
                new Promise<UserSearchResult>((resolve) => {
                    settlers.push(resolve);
                }),
        },
        settle: async (index, value) => {
            const settler = settlers[index];
            if (settler === undefined) {
                throw new Error(`expected a pending search at index ${index.toString()}`);
            }
            settler(value);
            await flush();
        },
    };
}

let container: HTMLDivElement;
let edits: string[] = [];

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function props(over: Partial<MentionEditorProps> = {}): MentionEditorProps {
    return {
        value: "",
        disabled: false,
        label: "Comment",
        userSearchProvider: { search: () => Promise.resolve({ users: [], hasMore: false }) },
        onLocalEdit: (state) => edits.push(state.text),
        ...over,
    };
}

function render(p: MentionEditorProps, into: HTMLElement = container): void {
    act(() => {
        ReactDOM.render(<MentionEditor {...p} />, into);
    });
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

function advance(ms: number = MENTION_SEARCH_DEBOUNCE_MS): void {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

function fieldIn(root: HTMLElement): HTMLTextAreaElement {
    const element = root.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

const field = (): HTMLTextAreaElement => fieldIn(container);

function type(next: string, into: HTMLTextAreaElement = field()): void {
    act(() => {
        into.value = next;
        into.setSelectionRange(next.length, next.length);
        Simulate.change(into);
    });
}

/** The positioned surface Fluent draws the suggestions on, if one is open. */
function surface(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(".fui-PopoverSurface");
}

function requiredSurface(): HTMLElement {
    const element = surface();
    if (element === null) {
        throw new Error("no positioned surface is open");
    }
    return element;
}

const options = (): readonly HTMLElement[] =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));

const listbox = (): HTMLElement | null =>
    document.body.querySelector<HTMLElement>('[role="listbox"]');

/** The element the positioning engine was last asked to position against. */
function lastPositionedAgainst(): unknown {
    const calls = (computePosition as jest.Mock).mock.calls as [unknown, unknown, unknown][];
    const last = calls[calls.length - 1];
    if (last === undefined) {
        throw new Error("nothing has been positioned");
    }
    return last[0];
}

/** What the positioning engine was last told to do. */
function lastPositioningOptions(): { placement: string; strategy: string } {
    const calls = (computePosition as jest.Mock).mock.calls as [
        unknown,
        unknown,
        { placement: string; strategy: string },
    ][];
    const last = calls[calls.length - 1];
    if (last === undefined) {
        throw new Error("nothing has been positioned");
    }
    return last[2];
}

/** Opens the picker on "@Da" and answers it with the given people. */
async function openWith(
    search: Controllable,
    users: readonly UserSuggestion[],
    hasMore = false
): Promise<void> {
    act(() => {
        field().focus();
        Simulate.focus(field());
    });
    type("@Da");
    advance();
    await search.settle(0, { users, hasMore });
}

beforeEach(() => {
    jest.useFakeTimers();
    (computePosition as jest.Mock).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    edits = [];

    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stubbedScrollIntoView(): void {
            // Not what these tests are about.
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

describe("where the suggestions are drawn", () => {
    it("puts the list outside the editor, not after the field", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana, danaWinter]);

        // The point of the exercise: a form that clips or scrolls what the
        // editor sits in cannot clip or scroll what is no longer inside it.
        expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
        expect(container.querySelector(".fui-PopoverSurface")).toBeNull();
        expect(options()).toHaveLength(2);
        expect(container.contains(requiredSurface())).toBe(false);
        expect(document.body.contains(requiredSurface())).toBe(true);
    });

    it("draws the waiting state in the same place as the answer", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        act(() => {
            field().focus();
            Simulate.focus(field());
        });
        type("@Da");
        advance();

        // Still searching: the spinner is on the positioned surface, so nothing
        // appears under the field first and jumps somewhere else a moment later.
        // (The container still *announces* the search in its live region — that
        // is a message for a screen reader, not a thing drawn under the field.)
        expect(requiredSurface().querySelector(".fui-Spinner")).not.toBeNull();
        expect(requiredSurface().textContent).toContain("Searching people");
        expect(container.querySelector(".fui-Spinner")).toBeNull();
        expect(options()).toEqual([]);

        await search.settle(0, { users: [dana], hasMore: false });

        expect(options()).toHaveLength(1);
        expect(requiredSurface().textContent).toContain("Dana");
    });

    it("positions against the field itself", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana]);

        // The textarea is the anchor — not a wrapper, not the form, not a
        // rectangle this code measured for itself.
        expect(lastPositionedAgainst()).toBe(field());
        expect(lastPositioningOptions().placement).toBe("bottom-start");
        expect(lastPositioningOptions().strategy).toBe("fixed");
    });

    it("asks for the placement the legacy control had", () => {
        // Asserted as the contract it is: what the popup asks Fluent for. Where
        // it physically lands is a browser's arithmetic, checked in a browser.
        expect(MENTION_POPUP_POSITIONING).toEqual({
            align: "start",
            flipBoundary: "window",
            matchTargetSize: "width",
            offset: 2,
            overflowBoundary: "window",
            overflowBoundaryPadding: 8,
            position: "below",
            strategy: "fixed",
        });
    });

    it("is the one card in the popup, and the list is not a second one", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        // This is the inverse of what this file asserted before, and deliberately
        // so. The surface used to be turned transparent while the list inside it
        // drew the card; in a real model-driven app that popup came up
        // see-through, because the list's background token does not resolve
        // inside a portal unless something put the theme there. The card belongs
        // to the surface now — the layer the theme reaches first — and the list
        // keeps only its rows.
        const chrome = window.getComputedStyle(requiredSurface());
        expect(chrome.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(chrome.backgroundColor).not.toBe("transparent");
        expect(chrome.backgroundColor).not.toBe("");

        const list = listbox();
        if (list === null) {
            throw new Error("no listbox is open");
        }
        const inner = window.getComputedStyle(list);
        // No competing card: no background, no border, no shadow of its own.
        expect(inner.backgroundColor === "" || inner.backgroundColor === "rgba(0, 0, 0, 0)").toBe(
            true
        );
        expect(inner.boxShadow === "" || inner.boxShadow === "none").toBe(true);
        expect(inner.padding === "" || inner.padding === "0px").toBe(true);

        // And exactly one thing still scrolls: the list itself.
        expect(chrome.overflowY === "" || chrome.overflowY === "visible").toBe(true);
        expect(inner.overflowY).toBe("auto");
    });

    it("draws nothing at all while there is nothing to offer", () => {
        render(props());

        expect(surface()).toBeNull();
        expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    });

    it("leaves nothing behind when the picker closes", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        expect(surface()).not.toBeNull();

        act(() => {
            Simulate.keyDown(field(), { key: "Escape" });
        });
        await flush();

        expect(surface()).toBeNull();
        expect(options()).toEqual([]);
    });

    it("leaves nothing behind when the editor goes away", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });

        expect(surface()).toBeNull();
        expect(options()).toEqual([]);
    });
});

describe("who has the keyboard while the suggestions are open", () => {
    it("never takes the caret out of the field", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        act(() => {
            field().focus();
            Simulate.focus(field());
        });
        type("@Da");
        expect(document.activeElement).toBe(field());

        advance();
        // While the search runs.
        expect(document.activeElement).toBe(field());

        await search.settle(0, { users: [dana, danaWinter], hasMore: false });
        // And once the answer is on screen.
        expect(document.activeElement).toBe(field());
    });

    it("does not add the surface to the tab order", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        // Tab belongs to the form the field sits on: the list is reached with
        // the arrow keys, not by tabbing into a box that appeared.
        const notATabStop = (element: HTMLElement): boolean => {
            const tabIndex = element.getAttribute("tabindex");
            return tabIndex === null || Number(tabIndex) < 0;
        };

        expect(notATabStop(requiredSurface())).toBe(true);
        expect(options().every(notATabStop)).toBe(true);
        // Nothing inside the surface offers itself to Tab either.
        expect(requiredSurface().querySelector("a, button, input, [tabindex]")).toBeNull();
    });

    it("keeps the field focused when an option is pressed", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        act(() => {
            options()[0]?.dispatchEvent(mousedown);
        });

        // The list refuses the mouse down, so the browser never moves the focus
        // and the mention is written into a field that still has the caret.
        expect(mousedown.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(field());
        expect(field().value).toBe("@Dana ");
    });

    it("still answers to the keys it always did", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        const activeName = (): string =>
            options().find((option) => option.getAttribute("aria-selected") === "true")
                ?.textContent ?? "";

        expect(activeName()).toContain("Dana");
        act(() => {
            Simulate.keyDown(field(), { key: "ArrowDown" });
        });
        expect(activeName()).toContain("Dana Winter");
        act(() => {
            Simulate.keyDown(field(), { key: "ArrowUp" });
        });
        expect(activeName()).toContain("Dana");

        act(() => {
            Simulate.keyDown(field(), { key: "Enter" });
        });
        expect(field().value).toBe("@Dana ");
        expect(surface()).toBeNull();
    });

    it("still writes the active option on Tab", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        act(() => {
            Simulate.keyDown(field(), { key: "Tab" });
        });

        expect(field().value).toBe("@Dana ");
    });
});

describe("what the field says about the suggestions", () => {
    it("names the list only while there is a list to name", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        expect(field().getAttribute("aria-expanded")).toBe("false");
        expect(field().getAttribute("aria-controls")).toBeNull();

        act(() => {
            field().focus();
            Simulate.focus(field());
        });
        type("@Da");
        advance();

        // Searching: a spinner is not a listbox, and the surface around it is
        // not one either. Pointing at either would name something unpickable.
        expect(field().getAttribute("aria-expanded")).toBe("true");
        expect(field().getAttribute("aria-controls")).toBeNull();

        await search.settle(0, { users: [dana], hasMore: false });

        const controls = field().getAttribute("aria-controls");
        expect(controls).not.toBeNull();
        expect(listbox()?.id).toBe(controls);
    });

    it("says nothing about a list when nobody matched", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, []);

        // The note is deliberately not an option, so nothing points at it.
        expect(requiredSurface().textContent).toContain("No people found");
        expect(listbox()).toBeNull();
        expect(field().getAttribute("aria-controls")).toBeNull();
        expect(field().getAttribute("aria-activedescendant")).toBeNull();
    });

    it("names the active option across the portal", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        const named = (): HTMLElement | null =>
            document.getElementById(field().getAttribute("aria-activedescendant") ?? "");

        expect(named()?.textContent).toContain("Dana");
        act(() => {
            Simulate.keyDown(field(), { key: "ArrowDown" });
        });
        // Ids are document-wide, so the reference still resolves from a textarea
        // in one subtree to an option in another.
        expect(named()?.textContent).toContain("Dana Winter");
        expect(named()?.getAttribute("role")).toBe("option");
    });

    it("keeps the more-results note out of the options", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana], true);

        expect(requiredSurface().textContent).toContain("More results available");
        expect(options()).toHaveLength(1);
    });
});

describe("two editors on one form", () => {
    let second: HTMLDivElement;

    beforeEach(() => {
        second = document.createElement("div");
        document.body.appendChild(second);
    });

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(second);
        });
        second.remove();
    });

    it("each anchors to its own field and names its own list", async () => {
        const first = controllableProvider();
        const other = controllableProvider();
        render(props({ userSearchProvider: first.provider, listboxId: "listbox-one" }));
        render(
            props({ userSearchProvider: other.provider, listboxId: "listbox-two" }),
            second
        );

        // The second editor is the one being typed in.
        const otherField = fieldIn(second);
        act(() => {
            otherField.focus();
            Simulate.focus(otherField);
        });
        type("@Da", otherField);
        advance();
        await other.settle(0, { users: [dana], hasMore: false });

        expect(lastPositionedAgainst()).toBe(otherField);
        expect(otherField.getAttribute("aria-controls")).toBe("listbox-two");
        expect(listbox()?.id).toBe("listbox-two");

        // And the untouched one stays shut, with nothing to point at.
        expect(field().getAttribute("aria-expanded")).toBe("false");
        expect(field().getAttribute("aria-controls")).toBeNull();
        expect(document.body.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    });
});

describe("what opening a popup costs the record", () => {
    it("reports nothing to the host for opening or closing", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        act(() => {
            field().focus();
            Simulate.focus(field());
        });
        type("@Da");
        const before = edits.length;
        advance();
        await search.settle(0, { users: [dana], hasMore: false });
        act(() => {
            Simulate.keyDown(field(), { key: "Escape" });
        });
        await flush();

        // Typing reports, as it always did. Showing a list, positioning it and
        // taking it away again are not edits and say nothing to anybody.
        expect(edits.length).toBe(before);
    });

    it("changes no text while the suggestions come and go", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        act(() => {
            field().focus();
            Simulate.focus(field());
        });
        type("Hello @Da");
        const written = edits.length;

        advance();
        await search.settle(0, { users: [dana], hasMore: false });
        act(() => {
            Simulate.keyDown(field(), { key: "Escape" });
        });
        await flush();

        expect(field().value).toBe("Hello @Da");
        expect(edits.length).toBe(written);
    });
});
