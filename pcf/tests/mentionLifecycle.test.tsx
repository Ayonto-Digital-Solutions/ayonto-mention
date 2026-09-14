import * as React from "react";
import * as ReactDOM from "react-dom";
import { Simulate, act } from "react-dom/test-utils";

import { MentionEditor } from "../src/components/MentionEditor";
import type {
    MentionEditorProps,
    MentionEditorState,
} from "../src/components/MentionEditor";
import { sameMentionOccurrences } from "../src/domain/mentionLifecycle";
import type { MentionOccurrence } from "../src/domain/mentionLifecycle";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../src/hooks/useMentionSearch";
import type {
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../src/domain/userSearch";

/** Fictional people. Two of them deliberately share a display name. */
const dana: UserSuggestion = { id: "u-dana", name: "Dana", email: "dana@example.invalid" };
/** The same person, offered by a suggestion that carries no address. */
const danaWithoutEmail: UserSuggestion = { id: "u-dana", name: "Dana" };
const robinA: UserSuggestion = { id: "id-a", name: "Robin Fox", jobTitle: "Field Engineer" };
const robinB: UserSuggestion = { id: "id-b", name: "Robin Fox", jobTitle: "Account Manager" };

interface Controllable {
    readonly provider: UserSearchProvider;
    readonly calls: readonly string[];
    settle(index: number, users: readonly UserSuggestion[]): Promise<void>;
}

function controllableProvider(): Controllable {
    const calls: string[] = [];
    const resolvers: ((value: UserSearchResult) => void)[] = [];
    return {
        calls,
        provider: {
            search: (term: string) => {
                calls.push(term);
                return new Promise<UserSearchResult>((resolve) => resolvers.push(resolve));
            },
        },
        settle: async (index, users) => {
            const resolve = resolvers[index];
            if (resolve === undefined) {
                throw new Error(`expected a pending search at index ${index.toString()}`);
            }
            resolve({ users, hasMore: false });
            await flush();
        },
    };
}

let container: HTMLDivElement;
/** Occurrences an edit added, the way a consumer of the reported state sees it. */
let selected: MentionOccurrence[] = [];
/** The reported set, kept only when it differs from the one before it. */
let snapshots: (readonly MentionOccurrence[])[] = [];
/** Every state the editor handed out, one per local edit or host adoption. */
let states: MentionEditorState[] = [];

/**
 * Takes one reported state the way the adapter does: an edit carries the text
 * and the mentions standing in it together, so what changed about the mentions
 * is read off the state rather than announced separately.
 */
function record(state: MentionEditorState): void {
    states.push(state);
    const previous = snapshots[snapshots.length - 1] ?? [];
    for (const mention of state.mentions) {
        const stood = previous.some(
            (before) => before.start === mention.start && before.userId === mention.userId
        );
        if (!stood) {
            selected.push(mention);
        }
    }
    if (!sameMentionOccurrences(previous, state.mentions)) {
        snapshots.push(state.mentions);
    }
}

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
        onLocalEdit: record,
        onHostValueAdopted: record,
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

function advance(): void {
    act(() => {
        jest.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
    });
}

function field(): HTMLTextAreaElement {
    const element = container.querySelector("textarea");
    if (element === null) {
        throw new Error("no textarea rendered");
    }
    return element;
}

function type(next: string, caret: number = next.length): void {
    const element = field();
    act(() => {
        element.value = next;
        element.setSelectionRange(caret, caret);
        Simulate.change(element);
    });
}

function press(key: string): void {
    act(() => {
        Simulate.keyDown(field(), { key });
    });
}

/** Opens the picker on the given query and answers it with the given people. */
async function offer(
    search: Controllable,
    query: string,
    users: readonly UserSuggestion[],
    index: number,
    caret?: number
): Promise<void> {
    type(query, caret);
    advance();
    await search.settle(index, users);
}

function latestSnapshot(): readonly MentionOccurrence[] {
    const snapshot = snapshots[snapshots.length - 1];
    if (snapshot === undefined) {
        throw new Error("no snapshot was reported");
    }
    return snapshot;
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    selected = [];
    snapshots = [];
    states = [];
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

describe("MentionEditor mention selection", () => {
    it("reports a written mention exactly once", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);

        const before = states.length;
        press("Enter");

        // One pick, one edit handed out, one new mention in it.
        expect(states).toHaveLength(before + 1);
        expect(selected).toHaveLength(1);
    });

    it("reports who was picked, where, and under which name", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "hi @Da", [dana], 0);

        press("Enter");

        expect(selected[0]).toEqual({
            start: 3,
            name: "Dana",
            userId: "u-dana",
            email: "dana@example.invalid",
        });
    });

    it("carries no address when the suggestion had none", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Ro", [robinA], 0);

        press("Enter");

        expect(selected[0]).toEqual({ start: 0, name: "Robin Fox", userId: "id-a" });
        expect(selected[0]).not.toHaveProperty("email");
    });

    it("reports nothing when the mention would not fit", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider, maxLength: 5 }));
        await offer(search, "@Ro", [robinA], 0);

        press("Enter");

        expect(selected).toEqual([]);
        expect(snapshots).toEqual([]);
    });

    it("reports nothing for plain typing", () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        type("Just a sentence");
        advance();

        expect(selected).toEqual([]);
        expect(states[states.length - 1]?.mentions).toEqual([]);
        expect(search.calls).toEqual([]);
    });
});

describe("MentionEditor written mentions", () => {
    it("reports the mention standing in the text after a selection", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);

        press("Enter");

        expect(latestSnapshot()).toEqual([
            { start: 0, name: "Dana", userId: "u-dana", email: "dana@example.invalid" },
        ]);
    });

    it("reports the mention gone once it is deleted", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");

        type("");

        expect(latestSnapshot()).toEqual([]);
    });

    it("moves the recorded position when text is inserted in front", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");

        type("Hi @Dana ", 3);

        expect(latestSnapshot()).toEqual([
            { start: 3, name: "Dana", userId: "u-dana", email: "dana@example.invalid" },
        ]);
    });

    /** Writes "Hello @Robin Fox and @Robin Fox ", the first being A, the second B. */
    async function writeBothNamesakes(search: Controllable): Promise<void> {
        await offer(search, "Hello @Ro", [robinA, robinB], 0);
        press("Enter");
        await offer(search, "Hello @Robin Fox and @Ro", [robinA, robinB], 1);
        press("ArrowDown");
        press("Enter");
    }

    it("keeps two people who share a display name apart", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        await writeBothNamesakes(search);

        // Same name in both places, two different people.
        expect(latestSnapshot()).toEqual([
            { start: 6, name: "Robin Fox", userId: "id-a" },
            { start: 21, name: "Robin Fox", userId: "id-b" },
        ]);
    });

    it("leaves the surviving namesake when the first is deleted", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await writeBothNamesakes(search);

        // The first occurrence is removed. The text left behind reads the same
        // whichever one went, so only the recorded positions can tell them apart
        // and the surviving identity must be B.
        type("Hello and @Robin Fox ");

        expect(latestSnapshot()).toEqual([{ start: 10, name: "Robin Fox", userId: "id-b" }]);
    });

    it("reports both occurrences when one person is mentioned twice", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");
        await offer(search, "@Dana @Da", [dana], 1);
        press("Enter");

        const snapshot = latestSnapshot();
        expect(snapshot).toHaveLength(2);
        expect(snapshot.map((mention) => mention.userId)).toEqual(["u-dana", "u-dana"]);
        expect(snapshot.map((mention) => mention.start)).toEqual([0, 6]);
    });

    it("hands out a fresh snapshot each time, never its own storage", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");

        const first = latestSnapshot();
        // Pushing into a snapshot a caller was handed must not reach the editor.
        (first as MentionOccurrence[]).push({ start: 99, name: "Nobody", userId: "u-none" });

        type("Hi @Dana ", 3);
        const second = latestSnapshot();

        expect(second).not.toBe(first);
        expect(second).toHaveLength(1);
        expect(second[0]?.userId).toBe("u-dana");
    });

    it("does not report again when nothing about the mentions changed", async () => {
        const search = controllableProvider();
        const base = props({ userSearchProvider: search.provider });
        render(base);
        await offer(search, "@Da", [dana], 0);
        press("Enter");
        const afterSelection = snapshots.length;

        // Renders and caret moves that leave the mentions exactly where they are.
        render({ ...base });
        render({ ...base });
        act(() => {
            field().setSelectionRange(6, 6);
            Simulate.click(field());
        });

        expect(snapshots).toHaveLength(afterSelection);
    });
});

describe("MentionEditor lifecycle under host reconciliation", () => {
    it("does not withdraw a mention because of a stale host echo", async () => {
        const search = controllableProvider();
        const base = props({ userSearchProvider: search.provider, value: "" });
        render(base);
        await offer(search, "@Da", [dana], 0);
        press("Enter");
        const reported = snapshots.length;

        // The host is still reporting the text from before the mention.
        render({ ...base, value: "@Da" });

        expect(snapshots).toHaveLength(reported);
        expect(latestSnapshot()).toEqual([
            { start: 0, name: "Dana", userId: "u-dana", email: "dana@example.invalid" },
        ]);
    });

    it("drops the mention when a genuine host value removes it", async () => {
        const search = controllableProvider();
        const base = props({ userSearchProvider: search.provider, value: "" });
        render(base);
        await offer(search, "@Da", [dana], 0);
        press("Enter");

        act(() => {
            Simulate.blur(field());
        });
        render({ ...base, value: "Rewritten by a business rule" });

        expect(latestSnapshot()).toEqual([]);
    });

    it("invents no identity for a name a host value merely contains", async () => {
        const search = controllableProvider();
        const base = props({ userSearchProvider: search.provider, value: "" });
        render(base);
        await offer(search, "@Ro", [robinA], 0);
        press("Enter");

        act(() => {
            Simulate.blur(field());
        });
        // The text says "@Robin Fox", but this editor never wrote that one and
        // cannot know which Robin Fox it means.
        render({ ...base, value: "Different text @Robin Fox mentioned" });

        expect(latestSnapshot()).toEqual([]);
    });
});

describe("MentionEditor occurrence metadata", () => {
    it("does not let an earlier address survive into a later selection of the same person", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");
        expect(latestSnapshot()[0]).toHaveProperty("email", "dana@example.invalid");

        // The mention is removed, then the same person is picked again from a
        // suggestion that has no address this time.
        type("");
        await offer(search, "@Da", [danaWithoutEmail], 1);
        press("Enter");

        expect(latestSnapshot()).toHaveLength(1);
        expect(latestSnapshot()[0]).not.toHaveProperty("email");
    });

    it("does not retroactively give an existing occurrence an address", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        // First occurrence: no address.
        await offer(search, "Hi @Da", [danaWithoutEmail], 0);
        press("Enter");
        // Second occurrence of the same person, this time with one.
        await offer(search, "Hi @Dana and @Da", [dana], 1);
        press("Enter");

        const snapshot = latestSnapshot();
        expect(snapshot).toHaveLength(2);
        expect(snapshot[0]).not.toHaveProperty("email");
        expect(snapshot[1]).toHaveProperty("email", "dana@example.invalid");
    });

    it("carries an occurrence's own address through reanchoring", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "Hi @Da", [danaWithoutEmail], 0);
        press("Enter");
        await offer(search, "Hi @Dana and @Da", [dana], 1);
        press("Enter");

        // An edit in front moves both occurrences; each keeps what it recorded.
        type("Oh, Hi @Dana and @Dana ", 4);

        const snapshot = latestSnapshot();
        expect(snapshot).toHaveLength(2);
        expect(snapshot[0]).not.toHaveProperty("email");
        expect(snapshot[1]).toHaveProperty("email", "dana@example.invalid");
        expect(snapshot[0]?.start).toBeLessThan(snapshot[1]?.start ?? 0);
    });
});

describe("MentionEditor snapshot isolation and ordering", () => {
    it("cannot have its comparison state corrupted through a delivered snapshot", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "@Da", [dana], 0);
        press("Enter");

        // Ordinary JavaScript can write through a readonly type.
        const delivered = latestSnapshot() as MentionOccurrence[];
        (delivered[0] as { start: number }).start = 999;
        (delivered[0] as { userId: string }).userId = "someone-else";
        delivered.push({ start: 50, name: "Nobody", userId: "u-none" });
        const reported = snapshots.length;

        // A caret move changes nothing about the mentions.
        act(() => {
            field().setSelectionRange(6, 6);
            Simulate.click(field());
        });
        expect(snapshots).toHaveLength(reported);

        // And a real change still reports the editor's own, correct values.
        type("Hi @Dana ", 3);
        expect(latestSnapshot()).toEqual([
            { start: 3, name: "Dana", userId: "u-dana", email: "dana@example.invalid" },
        ]);
    });

    it("reports occurrences in text order, whichever was written first", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));

        // The later mention is written first.
        await offer(search, "later @Da", [danaWithoutEmail], 0);
        press("Enter");
        // Then one before it.
        await offer(search, "@Da later @Dana ", [danaWithoutEmail], 1, 3);
        press("Enter");

        const starts = latestSnapshot().map((mention) => mention.start);
        expect(starts).toEqual([...starts].sort((left, right) => left - right));
        expect(starts).toHaveLength(2);
    });

    it("does not report again after a no-op once an earlier mention was inserted", async () => {
        const search = controllableProvider();
        render(props({ userSearchProvider: search.provider }));
        await offer(search, "later @Da", [danaWithoutEmail], 0);
        press("Enter");
        await offer(search, "@Da later @Dana ", [danaWithoutEmail], 1, 3);
        press("Enter");
        const reported = snapshots.length;

        // A caret move re-runs the reanchoring over unchanged text.
        act(() => {
            field().setSelectionRange(0, 0);
            Simulate.click(field());
        });

        expect(snapshots).toHaveLength(reported);
    });
});
