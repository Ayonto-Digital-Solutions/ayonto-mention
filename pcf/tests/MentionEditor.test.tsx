import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionEditor } from "../src/components/MentionEditor";
import type { MentionEditorProps } from "../src/components/MentionEditor";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import type {
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../src/domain/userSearch";

/** Fictional people. Two of them deliberately share a display name. */
const dana: UserSuggestion = { id: "u-dana", name: "Dana", jobTitle: "Support Lead" };
const danaWinter: UserSuggestion = { id: "u-dana-winter", name: "Dana Winter" };
const robinA: UserSuggestion = { id: "id-a", name: "Robin Fox", jobTitle: "Field Engineer" };
const robinB: UserSuggestion = { id: "id-b", name: "Robin Fox", jobTitle: "Account Manager" };

interface Controllable {
    readonly provider: UserSearchProvider;
    readonly calls: readonly string[];
    settle(index: number, value: UserSearchResult): Promise<void>;
    fail(index: number, reason: Error): Promise<void>;
}

function controllableProvider(): Controllable {
    const calls: string[] = [];
    const settlers: { resolve: (v: UserSearchResult) => void; reject: (e: Error) => void }[] = [];
    const at = (
        index: number
    ): { resolve: (v: UserSearchResult) => void; reject: (e: Error) => void } => {
        const settler = settlers[index];
        if (settler === undefined) {
            throw new Error(`expected a pending search at index ${index.toString()}`);
        }
        return settler;
    };

    return {
        provider: {
            search: (term: string) => {
                calls.push(term);
                return new Promise<UserSearchResult>((resolve, reject) => {
                    settlers.push({ resolve, reject });
                });
            },
        },
        calls,
        settle: async (index, value) => {
            at(index).resolve(value);
            await flush();
        },
        fail: async (index, reason) => {
            at(index).reject(reason);
            await flush();
        },
    };
}

let container: HTMLDivElement;
let changes: string[] = [];

/**
 * SuggestionList brings the active option into view, and jsdom implements no
 * scrollIntoView. It is stubbed here and put back exactly as found, so nothing
 * leaks into the environment.
 */
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
        onLocalEdit: (state) => changes.push(state.text),
        ...over,
    };
}

function render(p: MentionEditorProps): void {
    act(() => {
        ReactDOM.render(<MentionEditor {...p} />, container);
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

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

/** Replaces the text as a keystroke would, leaving the caret where given. */
function type(next: string, caret: number = next.length): void {
    const element = field();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
    });
}

function press(key: string, data: Record<string, unknown> = {}): void {
    act(() => {
        Simulate.keyDown(field(), { key, ...data });
    });
}

function moveCaret(caret: number): void {
    const element = field();
    act(() => {
        element.setSelectionRange(caret, caret);
        Simulate.click(element);
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

function statusText(): string {
    return container.querySelector('[role="status"]')?.textContent ?? "";
}

function clickOption(index: number): void {
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
        optionAt(index).dispatchEvent(event);
    });
}

/** Opens the picker on "@Da" and answers it with the given people. */
async function openWith(
    search: Controllable,
    users: readonly UserSuggestion[],
    hasMore = false
): Promise<void> {
    type("@Da");
    advance();
    await search.settle(0, { users, hasMore });
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    changes = [];

    Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        writable: true,
        value: function stubbedScrollIntoView(): void {
            // The editor's tests care about what is offered, not about scrolling.
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

describe("MentionEditor", () => {
    it("reports plain edits without opening the picker", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        type("Hello there");
        advance();

        expect(changes).toEqual(["Hello there"]);
        expect(search.calls).toEqual([]);
        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("gives the textarea combobox semantics and an accessible name", () => {
        render(props({ label: "Comment" }));

        expect(field().getAttribute("role")).toBe("combobox");
        expect(field().getAttribute("aria-autocomplete")).toBe("list");
        expect(field().getAttribute("aria-label")).toBe("Comment");
        expect(field().getAttribute("aria-expanded")).toBe("false");
        // Nothing is open, so nothing is controlled or active.
        expect(field().getAttribute("aria-controls")).toBeNull();
        expect(field().getAttribute("aria-activedescendant")).toBeNull();
    });

    it("opens a search when an @ trigger is typed", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        type("@Da");

        expect(search.calls).toEqual([]);
        advance();
        expect(search.calls).toEqual(["Da"]);
    });

    it("shows the results and points the combobox at them", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana, danaWinter]);

        expect(options()).toHaveLength(2);
        expect(optionAt(0).textContent).toContain("Dana");
        expect(field().getAttribute("aria-expanded")).toBe("true");
        expect(field().getAttribute("aria-controls")).toBe("ayonto-mention-suggestions");
        expect(field().getAttribute("aria-activedescendant")).toBe(
            "ayonto-mention-suggestions-option-0"
        );
    });

    it("hides the previous answer the moment the query changes", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        expect(options()).toHaveLength(1);

        // No timers advanced: the stale answer must be gone in this very render.
        type("@Dan");

        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-activedescendant")).toBeNull();
    });

    it("writes the picked name when an option is clicked", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        clickOption(1);

        expect(changes[changes.length - 1]).toBe("@Dana Winter ");
        expect(options()).toHaveLength(0);
    });

    it("selects the active option on Enter", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        press("Enter");

        expect(changes[changes.length - 1]).toBe("@Dana ");
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("selects the active option on Tab", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        press("Tab");

        expect(changes[changes.length - 1]).toBe("@Dana ");
    });

    it("does not select on the Enter that commits an IME candidate", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        press("Enter", { nativeEvent: { isComposing: true } });

        expect(changes).toEqual(["@Da"]);
        expect(options()).toHaveLength(1);
    });

    it("moves the active option down and wraps at the end", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        press("ArrowDown");
        expect(optionAt(1).getAttribute("aria-selected")).toBe("true");

        press("ArrowDown");
        expect(optionAt(0).getAttribute("aria-selected")).toBe("true");
    });

    it("moves the active option up and wraps at the start", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        press("ArrowUp");

        expect(optionAt(1).getAttribute("aria-selected")).toBe("true");
        expect(field().getAttribute("aria-activedescendant")).toBe(
            "ayonto-mention-suggestions-option-1"
        );
    });

    it("closes the picker on Escape", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        press("Escape");

        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("puts the caret behind the written mention", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        press("Enter");

        // "@Dana " is six characters; the caret sits behind the separating space.
        expect(field().selectionStart).toBe(6);
    });

    it("refuses a mention that would not fit and says so", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider, maxLength: 10 }));
        await openWith(search, [danaWinter]);

        press("Enter");

        // "@Dana Winter " is thirteen characters, past the ten allowed.
        expect(changes).toEqual(["@Da"]);
        expect(container.textContent).toContain("does not fit");
        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("passes maxLength on to ordinary editing", () => {
        render(props({ maxLength: 10 }));

        expect(field().getAttribute("maxlength")).toBe("10");
    });

    it("offers nobody while the field is disabled", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        expect(options()).toHaveLength(1);

        render(props({ userSearchProvider: search.provider, disabled: true }));

        expect(field().disabled).toBe(true);
        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("announces that a lookup is running, without offering options", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        type("@Da");
        advance();

        expect(search.calls).toEqual(["Da"]);
        expect(statusText()).toContain("Searching");
        expect(options()).toHaveLength(0);
    });

    it("announces how many suggestions are available", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana, danaWinter]);

        expect(statusText()).toContain("2 suggestions available");
        // The announcement is not something that can be picked.
        expect(options()).toHaveLength(2);
    });

    it("reports a failed lookup neutrally and never shows the underlying error", async () => {
        const errors: unknown[][] = [];
        const warnings: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
            errors.push(a);
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
            warnings.push(a);
        });

        try {
            const search = controllableProvider();
            render(props({ userSearchProvider: search.provider }));

            type("@Da");
            advance();
            await search.fail(0, new Error("Access denied at org-a1b2c3.example.invalid"));

            expect(container.textContent).toContain("could not be looked up");
            expect(container.textContent).not.toContain("Access denied");
            expect(container.textContent).not.toContain("example.invalid");
            expect(options()).toHaveLength(0);
            expect(field().getAttribute("aria-expanded")).toBe("false");
            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it("shows the more-results note when the source had more matches", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await openWith(search, [dana], true);

        expect(container.textContent).toContain("More results available");
        expect(options()).toHaveLength(1);
    });

    it("keeps two people with the same display name apart", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [robinA, robinB]);

        // The two read alike; only their ids and their positions tell them apart.
        expect(options()).toHaveLength(2);
        expect(optionAt(0).id).not.toBe(optionAt(1).id);
        expect(optionAt(0).textContent).toContain("Field Engineer");
        expect(optionAt(1).textContent).toContain("Account Manager");

        press("ArrowDown");
        // The second namesake is the active one, so it is that record — not the
        // one that merely shares its name — which Enter picks.
        expect(optionAt(1).getAttribute("aria-selected")).toBe("true");
        expect(field().getAttribute("aria-activedescendant")).toBe(optionAt(1).id);

        press("Enter");

        expect(changes[changes.length - 1]).toBe("@Robin Fox ");
    });

    it("does not reopen the picker while the sentence carries on past a mention", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        press("Enter");
        expect(changes[changes.length - 1]).toBe("@Dana ");

        type("@Dana thanks");
        advance();

        // Only the original "Da" was ever looked up.
        expect(search.calls).toEqual(["Da"]);
        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("moves a written mention along when text is inserted in front of it", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        press("Enter");

        // Type in front of the mention: it now starts three characters later.
        type("Hi @Dana ", 3);
        // Carrying the sentence on must still be recognised as the same mention,
        // which only holds if its recorded position moved with the edit.
        type("Hi @Dana thanks");
        advance();

        expect(search.calls).toEqual(["Da"]);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("forgets a mention the edit wrote into", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        press("Enter");

        // "@Dana" with an "s" typed onto it is a mention of nobody, so the spot is
        // an ordinary query again and the picker may open there.
        type("@Danas ", 6);
        advance();

        expect(search.calls).toEqual(["Da", "Danas"]);
        expect(field().getAttribute("aria-expanded")).toBe("true");
    });

    it("closes the picker when the field loses the focus", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        expect(options()).toHaveLength(1);

        act(() => {
            Simulate.blur(field());
        });

        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("does not adopt an incoming value while the field is being edited", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider, value: "" }));

        act(() => {
            Simulate.focus(field());
        });
        type("Half typed");

        // The host pushes a value mid-keystroke; taking it over would move the caret.
        render(props({ userSearchProvider: search.provider, value: "From the host" }));
        expect(field().value).toBe("Half typed");

        // Once the field is no longer being edited, a value arriving from the host
        // is adopted.
        act(() => {
            Simulate.blur(field());
        });
        render(props({ userSearchProvider: search.provider, value: "Set by the host" }));
        expect(field().value).toBe("Set by the host");
    });

    it("leaves the picker alone for a key it does not act on", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana, danaWinter]);

        press("a");

        expect(options()).toHaveLength(2);
        expect(optionAt(0).getAttribute("aria-selected")).toBe("true");
        expect(changes).toEqual(["@Da"]);
    });

    it("keeps the picker on a caret move that stays on the same mention", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        // The caret has not left the query it is on.
        moveCaret(3);
        advance();

        expect(field().getAttribute("aria-expanded")).toBe("true");
        expect(options()).toHaveLength(1);
        expect(search.calls).toEqual(["Da"]);
    });

    it("closes rather than re-aiming when the caret lands on another mention", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);

        // A second trigger further along, then the caret jumps back to the first.
        type("@Da and @Ro");
        moveCaret(3);

        expect(field().getAttribute("aria-expanded")).toBe("false");
        expect(options()).toHaveLength(0);
    });

    it("keeps an earlier mention when a second one is written after it", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        press("Enter");
        expect(changes[changes.length - 1]).toBe("@Dana ");

        type("@Dana @Ro");
        advance();
        await search.settle(1, { users: [robinA], hasMore: false });
        press("Enter");
        expect(changes[changes.length - 1]).toBe("@Dana @Robin Fox ");

        // The first mention survived the second insertion: carrying its sentence
        // on still does not reopen the picker over it.
        type("@Dana thanks @Robin Fox ", 12);
        advance();

        expect(search.calls).toEqual(["Da", "Ro"]);
    });

    it("uses the strings, placeholder and listbox id a host supplies", async () => {
        const search = controllableProvider();
        render(
            props({
                userSearchProvider: search.provider,
                placeholder: "Write a comment",
                listboxId: "second-editor",
                strings: {
                    placeholder: "Mit @ jemanden erwaehnen",
                    noResults: "Niemand gefunden",
                    searching: "Suche Personen",
                    lookupFailed: "Personen konnten nicht geladen werden.",
                    mentionTooLong: "Die Erwaehnung passt nicht mehr.",
                    moreResults: "Weitere Treffer vorhanden.",
                    suggestionsAvailable: (count) => `${count.toString()} Vorschlaege`,
                    maskedValue: "* * *",
                    offlineNotice: "Keine Verbindung.",
                    charactersLeft: (remaining) => `${remaining.toString()} Zeichen uebrig`,
                    openMentionedUser: (name) => `${name} oeffnen`,
                },
            })
        );

        expect(field().getAttribute("placeholder")).toBe("Write a comment");

        await openWith(search, [dana], true);

        expect(field().getAttribute("aria-controls")).toBe("second-editor");
        expect(optionAt(0).id).toBe("second-editor-option-0");
        expect(statusText()).toContain("1 Vorschlaege");
        expect(container.textContent).toContain("Weitere Treffer vorhanden.");
    });

    it("keeps a later mention when a new one is written in front of it", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        press("Enter");
        expect(changes[changes.length - 1]).toBe("@Dana ");

        // A second trigger, this time before the mention that is already there.
        type("@Ro @Dana ", 3);
        advance();
        await search.settle(1, { users: [robinA], hasMore: false });
        press("Enter");

        expect(changes[changes.length - 1]).toBe("@Robin Fox @Dana ");

        // The mention that was pushed to the right survived, so carrying its
        // sentence on still does not reopen the picker over it.
        type("@Robin Fox @Dana thanks");
        advance();

        expect(search.calls).toEqual(["Da", "Ro"]);
    });

    it("does not open the picker on caret movement alone", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider, value: "Hello @Dana" }));

        moveCaret(11);
        advance();

        expect(search.calls).toEqual([]);
        expect(options()).toHaveLength(0);
        expect(field().getAttribute("aria-expanded")).toBe("false");
    });

    it("lets caret movement close a picker that typing opened", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await openWith(search, [dana]);
        expect(options()).toHaveLength(1);

        // Away from the mention entirely: the picker closes rather than re-aiming.
        type("@Da other", 9);
        moveCaret(0);

        expect(field().getAttribute("aria-expanded")).toBe("false");
    });
});

describe("MentionEditor value reconciliation", () => {
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

    it("converges to a host value that arrived while editing, once editing ends", () => {
        render(props({ value: "" }));
        focusField();
        type("Local");

        // The host decides on a value of its own mid-edit. It is held, not applied.
        render(props({ value: "Host decided" }));
        expect(field().value).toBe("Local");

        // Editing ends, and nothing further arrives from the host.
        blurField();

        expect(field().value).toBe("Host decided");
    });

    it("does not revert to an older prop after ordinary typing and blur", () => {
        render(props({ value: "Original" }));
        focusField();
        type("Typed over");

        blurField();

        // No host value ever arrived, so there is nothing to converge to.
        expect(field().value).toBe("Typed over");
    });

    it("ignores a delayed echo of text that was typed earlier", () => {
        render(props({ value: "" }));
        focusField();
        type("ab");
        type("abc");

        // The host echoes the keystroke before last. It is this editor's own text
        // coming back late, not a decision, so it must not win.
        render(props({ value: "ab" }));
        blurField();

        expect(field().value).toBe("abc");
    });

    it("ignores a delayed echo that only arrives after editing has ended", () => {
        render(props({ value: "" }));
        focusField();
        type("ab");
        type("abc");
        blurField();
        expect(field().value).toBe("abc");

        // The echo of an earlier keystroke turns up late, with the field no longer
        // focused. Taking it over would silently undo what was typed.
        render(props({ value: "ab" }));

        expect(field().value).toBe("abc");
    });

    it("lets a local edit supersede a host value that arrived before it", () => {
        render(props({ value: "" }));
        focusField();

        render(props({ value: "Host decided" }));
        // The person editing acted after the host did.
        type("Local wins");
        blurField();

        expect(field().value).toBe("Local wins");
    });

    it("still applies a host value while the field is not being edited", () => {
        render(props({ value: "First" }));
        expect(field().value).toBe("First");

        render(props({ value: "Second" }));

        expect(field().value).toBe("Second");
    });

    it("keeps the caret where it is when a host value arrives mid-edit", () => {
        render(props({ value: "" }));
        focusField();
        type("Hello", 5);

        render(props({ value: "Host decided" }));

        expect(field().value).toBe("Hello");
        expect(field().selectionStart).toBe(5);
    });

    it("lets the host set a value the editor emitted before, once it was acknowledged", () => {
        // The host owns the column and may legitimately put back a value this
        // editor happened to send earlier. Once host and editor have agreed on
        // the current text, the older emitted values must stop shadowing that.
        render(props({ value: "A" }));
        focusField();
        type("AB");

        // The host catches up and reports exactly what the editor shows.
        render(props({ value: "AB" }));
        expect(field().value).toBe("AB");

        blurField();

        // Later, with nobody editing, the host decides on "A" again.
        render(props({ value: "A" }));

        expect(field().value).toBe("A");
    });

    it("takes a later host value over normally after one was adopted on blur", () => {
        render(props({ value: "" }));
        focusField();
        type("Local");
        render(props({ value: "Host decided" }));
        blurField();
        expect(field().value).toBe("Host decided");

        render(props({ value: "Host again" }));

        expect(field().value).toBe("Host again");
    });
});

describe("MentionEditor with nobody to open", () => {
    it("still shows the mention, as something to read rather than to press", async () => {
        // A caller that hands over no way to open a person still gets the
        // mention drawn: knowing who is meant is worth something on its own.
        render(
            props({
                value: "Hi @Alex Rivera",
                initialMentions: [{ start: 3, name: "Alex Rivera", userId: "u-alex" }],
                userDirectory: { resolveName: () => Promise.resolve("Alex Rivera") },
            })
        );
        await flush();

        const token = container.querySelector("button");
        expect(token?.textContent).toContain("Alex Rivera");
        expect(token?.hasAttribute("disabled")).toBe(true);
        expect(() => {
            act(() => {
                Simulate.click(token as HTMLElement);
            });
        }).not.toThrow();
    });
});
