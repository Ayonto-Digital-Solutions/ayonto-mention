import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

import {
    MENTION_SEARCH_DEBOUNCE_MS,
    useMentionSearch,
} from "../src/hooks/useMentionSearch";
import type { MentionSearchState } from "../src/hooks/useMentionSearch";
import type {
    UserSearchProvider,
    UserSearchResult,
    UserSuggestion,
} from "../src/domain/userSearch";

const alex: UserSuggestion = { id: "u-alex", name: "Alex Rivera" };
const dana: UserSuggestion = { id: "u-dana", name: "Dana Winter" };

function result(users: readonly UserSuggestion[], hasMore = false): UserSearchResult {
    return { users, hasMore };
}

/** A provider whose answers are handed out by the test, one call at a time. */
interface Controllable {
    readonly provider: UserSearchProvider;
    readonly calls: readonly string[];
    resolveCall(index: number, value: UserSearchResult): Promise<void>;
    rejectCall(index: number, reason: Error): Promise<void>;
}

function controllableProvider(): Controllable {
    const calls: string[] = [];
    const settlers: { resolve: (v: UserSearchResult) => void; reject: (e: Error) => void }[] = [];

    const settlerAt = (index: number): { resolve: (v: UserSearchResult) => void; reject: (e: Error) => void } => {
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
        resolveCall: async (index, value) => {
            settlerAt(index).resolve(value);
            await flush();
        },
        rejectCall: async (index, reason) => {
            settlerAt(index).reject(reason);
            await flush();
        },
    };
}

let container: HTMLDivElement;
let latest: MentionSearchState | undefined;
let renderCount = 0;

function Probe(props: { query: string | null; provider: UserSearchProvider }): null {
    renderCount += 1;
    latest = useMentionSearch(props.query, props.provider);
    return null;
}

function render(query: string | null, provider: UserSearchProvider): void {
    act(() => {
        ReactDOM.render(<Probe provider={provider} query={query} />, container);
    });
}

/** Lets the pending promise continuations run under fake timers. */
async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

function advance(ms: number): void {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

function state(): MentionSearchState {
    if (latest === undefined) {
        throw new Error("the hook has not rendered yet");
    }
    return latest;
}

beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    latest = undefined;
    renderCount = 0;
});

afterEach(() => {
    act(() => {
        ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.useRealTimers();
});

describe("useMentionSearch", () => {
    it("starts closed, with nothing to show and nothing in flight", () => {
        render(null, controllableProvider().provider);

        expect(state().suggestions).toEqual([]);
        expect(state().hasMore).toBe(false);
        expect(state().isSearching).toBe(false);
        expect(state().hasError).toBe(false);
        expect(state().activeIndex).toBe(0);
    });

    it("does not search before the debounce has elapsed", () => {
        const search = controllableProvider();
        render("Ale", search.provider);

        advance(MENTION_SEARCH_DEBOUNCE_MS - 1);

        expect(search.calls).toEqual([]);
        // Something is on its way, even though the request has not gone out.
        expect(state().isSearching).toBe(true);
    });

    it("searches once the debounce has elapsed", () => {
        const search = controllableProvider();
        render("Ale", search.provider);

        advance(MENTION_SEARCH_DEBOUNCE_MS);

        expect(search.calls).toEqual(["Ale"]);
    });

    it("exposes the answer to the current query", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        await search.resolveCall(0, result([alex, dana]));

        expect(state().suggestions).toEqual([alex, dana]);
        expect(state().isSearching).toBe(false);
        expect(state().hasError).toBe(false);
    });

    it("passes on that the source had more matches", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        await search.resolveCall(0, result([alex], true));

        expect(state().hasMore).toBe(true);
    });

    it("replacing the query cancels the debounce of the one before it", () => {
        const search = controllableProvider();
        render("Al", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS - 50);

        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        // The first query never went out: only the query still being asked did.
        expect(search.calls).toEqual(["Ale"]);
    });

    it("hides the previous answer the moment a new query is asked", async () => {
        const search = controllableProvider();
        render("Al", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(0, result([alex]));
        expect(state().suggestions).toEqual([alex]);

        // No timers advanced: the old answer must be gone in this very render.
        render("Ale", search.provider);

        expect(state().suggestions).toEqual([]);
        expect(state().hasMore).toBe(false);
        expect(state().isSearching).toBe(true);
    });

    it("ignores an answer to a query that has since been replaced", async () => {
        const search = controllableProvider();
        render("Al", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        expect(search.calls).toEqual(["Al", "Ale"]);

        // The newer answer lands first, then the older one. The stale answer must
        // not overwrite it, whichever order they arrive in.
        await search.resolveCall(1, result([dana]));
        await search.resolveCall(0, result([alex]));

        expect(state().suggestions).toEqual([dana]);
    });

    it("ignores a failure that belongs to a query already replaced", async () => {
        const search = controllableProvider();
        render("Al", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        // The abandoned lookup fails. The query being asked knows nothing of it.
        await search.rejectCall(0, new Error("Access denied"));

        expect(search.calls).toEqual(["Al", "Ale"]);
        expect(state().hasError).toBe(false);
        expect(state().isSearching).toBe(true);

        await search.resolveCall(1, result([dana]));

        expect(state().hasError).toBe(false);
        expect(state().suggestions).toEqual([dana]);
    });

    it("clearing the query empties the state at once", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(0, result([alex, dana], true));

        render(null, search.provider);

        expect(state().suggestions).toEqual([]);
        expect(state().hasMore).toBe(false);
        expect(state().isSearching).toBe(false);
        expect(state().hasError).toBe(false);
    });

    it("reports a failed lookup without showing anything", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);

        await search.rejectCall(0, new Error("Access denied"));

        expect(state().hasError).toBe(true);
        expect(state().suggestions).toEqual([]);
        expect(state().isSearching).toBe(false);
    });

    it("does not log the failure", async () => {
        const errors: unknown[][] = [];
        const warnings: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args);
        });
        const warnSpy = jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
            warnings.push(args);
        });

        try {
            const search = controllableProvider();
            render("Ale", search.provider);
            advance(MENTION_SEARCH_DEBOUNCE_MS);
            await search.rejectCall(0, new Error("Access denied at org-a1b2c3.example.invalid"));

            expect(state().hasError).toBe(true);
            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        } finally {
            errorSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it("clears the error once the next query succeeds", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.rejectCall(0, new Error("Access denied"));
        expect(state().hasError).toBe(true);

        render("Alex", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(1, result([alex]));

        expect(state().hasError).toBe(false);
        expect(state().suggestions).toEqual([alex]);
    });

    it("lets the caller move the active index", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(0, result([alex, dana]));

        act(() => {
            state().setActiveIndex(1);
        });

        expect(state().activeIndex).toBe(1);
    });

    it("puts the active index back to the top when new results are accepted", async () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(0, result([alex, dana]));
        act(() => {
            state().setActiveIndex(1);
        });
        expect(state().activeIndex).toBe(1);

        render("Alex", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS);
        await search.resolveCall(1, result([dana, alex]));

        // The old index pointed into a list that no longer exists.
        expect(state().activeIndex).toBe(0);
    });

    it("does not update state after unmounting", async () => {
        const errors: unknown[][] = [];
        const errorSpy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args);
        });

        try {
            const search = controllableProvider();
            render("Ale", search.provider);
            advance(MENTION_SEARCH_DEBOUNCE_MS);
            expect(search.calls).toEqual(["Ale"]);

            act(() => {
                ReactDOM.unmountComponentAtNode(container);
            });
            const rendersBeforeAnswer = renderCount;

            await search.resolveCall(0, result([alex]));

            // React warns through console.error when an unmounted component is
            // updated, and a re-render would prove the same thing.
            expect(errors).toEqual([]);
            expect(renderCount).toBe(rendersBeforeAnswer);
        } finally {
            errorSpy.mockRestore();
        }
    });

    it("does not restart the search when only the provider identity changes", () => {
        const search = controllableProvider();
        render("Ale", search.provider);
        advance(MENTION_SEARCH_DEBOUNCE_MS - 50);

        // A caller that builds its provider inline hands over a new object every
        // render; that must not push the pending lookup away.
        render("Ale", { search: search.provider.search.bind(search.provider) });
        advance(50);

        expect(search.calls).toEqual(["Ale"]);
    });
});
