import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { SuggestionList } from "../src/components/SuggestionList";
import type { SuggestionListProps } from "../src/components/SuggestionList";
import type { UserSuggestion } from "../src/domain/userSearch";

/** Fictional people. Two of them deliberately share a display name. */
const alex: UserSuggestion = { id: "u-alex", name: "Alex Rivera", jobTitle: "Support Lead" };
const dana: UserSuggestion = { id: "u-dana", name: "Dana Winter" };
const robinA: UserSuggestion = { id: "id-a", name: "Robin Fox", jobTitle: "Field Engineer" };
const robinB: UserSuggestion = { id: "id-b", name: "Robin Fox", jobTitle: "Account Manager" };

const twoPeople: readonly UserSuggestion[] = [alex, dana];

let container: HTMLDivElement;
let scrollCalls: unknown[][] = [];

/** jsdom implements no scrollIntoView, so it is stubbed and then put back exactly as found. */
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView"
);

function baseProps(over: Partial<SuggestionListProps> = {}): SuggestionListProps {
    return {
        id: "ayonto-suggestions",
        suggestions: twoPeople,
        activeIndex: 0,
        optionId: (index: number) => `ayonto-suggestion-${index.toString()}`,
        onSelect: () => undefined,
        onHover: () => undefined,
        emptyLabel: "No people found",
        ...over,
    };
}

function render(props: SuggestionListProps): void {
    act(() => {
        ReactDOM.render(React.createElement(SuggestionList, props), container);
    });
}

function options(): readonly HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}

function optionAt(index: number): HTMLElement {
    const option = options()[index];
    if (option === undefined) {
        throw new Error(`expected an option at index ${index.toString()}`);
    }
    return option;
}

/** Dispatches a real event, so preventDefault can be observed on the native event. */
function dispatch(target: Element, type: string): Event {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    scrollCalls = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stubbedScrollIntoView(...args: unknown[]): void {
            scrollCalls.push(args);
        },
    });
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();

    if (originalScrollIntoView === undefined) {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    } else {
        Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    }
});

describe("SuggestionList", () => {
    it("shows the empty label and offers nothing to pick when there are no suggestions", () => {
        render(baseProps({ suggestions: [], emptyLabel: "No people found" }));

        expect(container.textContent).toContain("No people found");
        expect(options()).toHaveLength(0);
        // Nothing is selectable, so no listbox is announced either.
        expect(container.querySelector('[role="listbox"]')).toBeNull();
    });

    it("renders the list as a listbox of options", () => {
        render(baseProps());

        const listbox = container.querySelector('[role="listbox"]');
        expect(listbox).not.toBeNull();
        expect(listbox?.id).toBe("ayonto-suggestions");
        expect(options()).toHaveLength(2);
    });

    it("shows each name and the job title only when there is one", () => {
        render(baseProps());

        expect(optionAt(0).textContent).toContain("Alex Rivera");
        expect(optionAt(0).textContent).toContain("Support Lead");
        expect(optionAt(1).textContent).toContain("Dana Winter");
        expect(optionAt(1).textContent).not.toContain("Support Lead");
    });

    it("takes the option ids from the parent", () => {
        render(baseProps());

        expect(optionAt(0).id).toBe("ayonto-suggestion-0");
        expect(optionAt(1).id).toBe("ayonto-suggestion-1");
    });

    it("marks only the active option as selected", () => {
        render(baseProps({ activeIndex: 1 }));

        expect(optionAt(0).getAttribute("aria-selected")).toBe("false");
        expect(optionAt(1).getAttribute("aria-selected")).toBe("true");
    });

    it("moves the selected state when the active index changes", () => {
        const props = baseProps({ activeIndex: 0 });
        render(props);
        expect(optionAt(0).getAttribute("aria-selected")).toBe("true");

        render({ ...props, activeIndex: 1 });

        expect(optionAt(0).getAttribute("aria-selected")).toBe("false");
        expect(optionAt(1).getAttribute("aria-selected")).toBe("true");
    });

    it("keeps two people with the same display name apart by their id", () => {
        const picked: UserSuggestion[] = [];
        render(
            baseProps({
                suggestions: [robinA, robinB],
                onSelect: (user) => picked.push(user),
            })
        );

        expect(options()).toHaveLength(2);
        expect(optionAt(0).textContent).toContain("Field Engineer");
        expect(optionAt(1).textContent).toContain("Account Manager");

        dispatch(optionAt(1), "mousedown");

        // The identity is the id, never the name the two share.
        expect(picked).toEqual([robinB]);
        expect(picked[0]?.id).toBe("id-b");
    });

    it("reports the hovered index", () => {
        const hovered: number[] = [];
        render(baseProps({ onHover: (index) => hovered.push(index) }));

        act(() => {
            Simulate.mouseEnter(optionAt(1));
        });

        expect(hovered).toEqual([1]);
    });

    it("reports the clicked suggestion", () => {
        const picked: UserSuggestion[] = [];
        render(baseProps({ onSelect: (user) => picked.push(user) }));

        dispatch(optionAt(0), "mousedown");

        expect(picked).toEqual([alex]);
    });

    it("prevents the default on an option mousedown, so the editor keeps focus", () => {
        render(baseProps());

        expect(dispatch(optionAt(0), "mousedown").defaultPrevented).toBe(true);
    });

    it("prevents the default on the list itself, so padding and scrollbar do not blur the editor", () => {
        render(baseProps());

        const listbox = container.querySelector('[role="listbox"]');
        expect(listbox).not.toBeNull();
        const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        act(() => {
            listbox?.dispatchEvent(event);
        });

        expect(event.defaultPrevented).toBe(true);
    });

    it("hides the decorative avatar from the accessibility tree", () => {
        render(baseProps());

        // The name is already the option's accessible name; the avatar must not
        // repeat it.
        expect(optionAt(0).querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it("omits the more-results note when none was given", () => {
        render(baseProps());

        expect(container.textContent).not.toContain("More results");
        expect(options()).toHaveLength(2);
    });

    it("shows the more-results note without making it selectable", () => {
        render(baseProps({ moreLabel: "More results available" }));

        expect(container.textContent).toContain("More results available");
        // Still two options: the note is a remark about the result set, not a
        // person that could be picked.
        expect(options()).toHaveLength(2);

        const note = container.querySelector('li[aria-hidden="true"]');
        expect(note).not.toBeNull();
        expect(note?.getAttribute("role")).toBeNull();
        expect(note?.textContent).toContain("More results available");
    });

    it("brings the active option into view, and again when the active index changes", () => {
        const props = baseProps({ activeIndex: 0 });
        render(props);

        expect(scrollCalls).toHaveLength(1);
        expect(scrollCalls[0]).toEqual([{ block: "nearest" }]);

        render({ ...props, activeIndex: 1 });

        expect(scrollCalls).toHaveLength(2);
    });

    it("stubs scrollIntoView without leaking it into the environment", () => {
        // jsdom ships no scrollIntoView, so the suite must put that back: the
        // teardown deletes the stub rather than leaving a fake behind.
        expect(originalScrollIntoView).toBeUndefined();
        expect(typeof Element.prototype.scrollIntoView).toBe("function");
    });
});
