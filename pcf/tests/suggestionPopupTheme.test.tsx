import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";
import { webLightTheme } from "@fluentui/react-components";

import { MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import type { UserSuggestion } from "../src/domain/userSearch";

/**
 * What this file is about: the suggestion popup is portalled out of the editor's
 * subtree, and a portalled element is a child of the document body rather than
 * of anything this component rendered. CSS custom properties do **not** reach it
 * by inheritance, which is why a popup whose background came from a Fluent token
 * came up see-through in a real model-driven app.
 *
 * Fluent's own answer is to copy the nearest provider's class onto the portal
 * node it creates. That copy is a real, observable thing even in an environment
 * that does no layout, and it is what these tests check: the portal carries the
 * provider's theme class, and that class defines the tokens.
 *
 * What they deliberately do not claim is that the popup *looks* opaque. jsdom
 * resolves no custom properties and paints nothing, so "the user can no longer
 * see the form through the list" is neither true nor false here. That belongs to
 * a browser, and to the DEV acceptance test.
 */

const dana: UserSuggestion = { id: "u-dana", name: "Dana Winter" };

let container: HTMLDivElement;

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function props(over: Partial<MentionEditorProps> = {}): MentionEditorProps {
    return {
        value: "",
        disabled: false,
        label: "Comment",
        userSearchProvider: { search: () => Promise.resolve({ users: [dana], hasMore: false }) },
        onLocalEdit: () => undefined,
        ...over,
    };
}

function render(p: MentionEditorProps): void {
    act(() => {
        ReactDOM.render(<MentionEditor {...p} />, container);
    });
}

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

/** Types "@Da" and lets the debounced search settle, so the popup is open. */
async function openPicker(): Promise<void> {
    act(() => {
        field().focus();
        Simulate.focus(field());
    });
    act(() => {
        field().value = "@Da";
        field().setSelectionRange(3, 3);
        Simulate.change(field());
    });
    act(() => {
        jest.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

/** The node Fluent creates on the body to portal the popup into. */
function portalNode(): HTMLElement {
    const element = document.body.querySelector<HTMLElement>('[data-portal-node="true"]');
    if (element === null) {
        throw new Error("no portal node was created");
    }
    return element;
}

function providerRoot(): HTMLElement {
    const element = container.querySelector<HTMLElement>(".fui-FluentProvider");
    if (element === null) {
        throw new Error("no theme provider was rendered");
    }
    return element;
}

/**
 * The class that carries a provider's CSS custom properties.
 *
 * Fluent names it `fui-FluentProvider<n>` and writes the token rule for it into
 * a style element. It is the one class that matters here: without it on the
 * portal node, every `var(--color…)` inside the popup resolves to nothing and
 * the background falls back to transparent.
 */
function themeClassOf(element: HTMLElement): string {
    const found = element.className
        .split(/\s+/)
        .filter((name) => /^fui-FluentProvider\d+$/.test(name));
    const only = found[0];
    if (found.length !== 1 || only === undefined) {
        throw new Error(`expected exactly one theme class, found ${JSON.stringify(found)}`);
    }
    return only;
}

/**
 * Every rule the document currently carries, as one string.
 *
 * Read through the CSSOM rather than from the elements' text: both Griffel and
 * Fluent's theme style tag insert rules with `insertRule`, which leaves the
 * `<style>` element's `textContent` empty.
 */
function styleSheetText(): string {
    return Array.from(document.styleSheets)
        .flatMap((sheet) => {
            try {
                return Array.from(sheet.cssRules).map((rule) => rule.cssText);
            } catch {
                // A sheet the environment will not let us read is not ours.
                return [];
            }
        })
        .join("\n");
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);

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

describe("the theme the portalled suggestion popup is drawn in", () => {
    it("reaches the portal node, which is the whole point of the provider", async () => {
        render(props());
        await openPicker();

        // The mechanism, stated as an assertion: Fluent copies the provider's
        // theme class onto the node it portals into. If this ever stops being
        // true, the popup loses its tokens and goes transparent again.
        expect(themeClassOf(portalNode())).toBe(themeClassOf(providerRoot()));
    });

    it("is the host's own theme when the host supplies one", async () => {
        const hostTheme = { ...webLightTheme, colorNeutralBackground1: "rgb(1, 2, 3)" };
        render(props({ theme: hostTheme }));
        await openPicker();

        // The host's value is what the tokens on the portal actually resolve to.
        const rules = styleSheetText();
        expect(rules).toContain(themeClassOf(portalNode()));
        expect(rules).toContain("--colorNeutralBackground1: rgb(1, 2, 3)");
    });

    it("falls back to a real theme when the host supplies none", async () => {
        // A provider with no theme would hand the portal a class that defines no
        // tokens — the same failure, arrived at politely. So the editor always
        // has one, and says so in its own documentation.
        render(props());
        await openPicker();

        expect(styleSheetText()).toContain(`.${themeClassOf(portalNode())}`);
        expect(styleSheetText()).toContain("--colorNeutralBackground1");
    });

    it("leans dark when the host says the app is dark", async () => {
        render(props({ isDarkTheme: true }));
        await openPicker();
        const dark = themeClassOf(portalNode());
        const darkRules = styleSheetText();

        act(() => {
            ReactDOM.unmountComponentAtNode(container);
        });
        render(props({ isDarkTheme: false }));
        await openPicker();

        // Two different token sets, not one theme used twice.
        expect(themeClassOf(portalNode())).not.toBe(dark);
        expect(darkRules).not.toBe(styleSheetText());
    });

    it("keeps the provider out of the layout entirely", async () => {
        render(props());
        await openPicker();

        // The provider exists for its class and its React context. Fluent's own
        // provider root would otherwise paint a background and impose body1 type
        // on the field it wraps, and it would take a slot in the editor's flex
        // column. With no box it does none of that.
        expect(window.getComputedStyle(providerRoot()).display).toBe("contents");
    });

    it("does not disturb the listbox the editor points at", async () => {
        render(props({ listboxId: "ayonto-suggestions-7" }));
        await openPicker();

        // The provider sits between the editor and the popover, so this is the
        // guard that it changed nothing about what the textarea names.
        const listbox = document.body.querySelector('[role="listbox"]');
        expect(listbox?.id).toBe("ayonto-suggestions-7");
        expect(field().getAttribute("aria-controls")).toBe("ayonto-suggestions-7");
        expect(field().getAttribute("aria-activedescendant")).toBe(
            document.body.querySelector('[role="option"]')?.id
        );
    });
});
