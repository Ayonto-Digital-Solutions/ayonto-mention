import * as React from "react";

import type { UserSearchProvider, UserSuggestion } from "../domain/userSearch";

/**
 * How long the typing has to settle before a lookup goes out. Long enough that a
 * name is not searched letter by letter, short enough that the list still feels
 * like it follows the caret.
 */
export const MENTION_SEARCH_DEBOUNCE_MS = 250;

export interface MentionSearchState {
    readonly suggestions: readonly UserSuggestion[];
    /** True when the source had more matches than were returned. */
    readonly hasMore: boolean;
    /** True from the keystroke until the answer for that exact query has landed. */
    readonly isSearching: boolean;
    /** True when the lookup for the current query failed. */
    readonly hasError: boolean;
    readonly activeIndex: number;
    readonly setActiveIndex: (index: number) => void;
}

/** Results always travel with the query they answer, so stale ones can be told apart. */
interface SearchState {
    readonly query: string | null;
    readonly suggestions: readonly UserSuggestion[];
    readonly hasMore: boolean;
    readonly hasError: boolean;
    readonly activeIndex: number;
}

const NO_SUGGESTIONS: readonly UserSuggestion[] = [];

const CLOSED: SearchState = {
    query: null,
    suggestions: NO_SUGGESTIONS,
    hasMore: false,
    hasError: false,
    activeIndex: 0,
};

/**
 * Owns the state behind the mention picker: when to search, what to show, and
 * which option is active.
 *
 * Platform-neutral by construction — it knows a `UserSearchProvider` and React,
 * and nothing about Dataverse or the component framework.
 *
 * `query` is what the caret is currently asking for, or `null` when the picker is
 * closed. Results are held together with the query that produced them, so a
 * result is only ever shown for the query actually being asked. That is what
 * makes a newer query hide an older answer in the same render, with no frame in
 * which the list shows one name while the text says another.
 */
export function useMentionSearch(
    query: string | null,
    provider: UserSearchProvider
): MentionSearchState {
    const [state, setState] = React.useState<SearchState>(CLOSED);

    // Held in a ref so that a caller who builds the provider inline — as a control
    // does when it hands over a fresh `context.webAPI` wrapper each render — does
    // not restart the debounce on every render.
    const providerRef = React.useRef(provider);
    React.useEffect(() => {
        providerRef.current = provider;
    });

    React.useEffect(() => {
        if (query === null) {
            setState((current) => (current === CLOSED ? current : CLOSED));
            return undefined;
        }

        // Set by the cleanup below, which React runs both when the query changes
        // and when the component unmounts. An answer that arrives afterwards
        // belongs to a question nobody is asking any more.
        let cancelled = false;

        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const result = await providerRef.current.search(query);
                    if (cancelled) {
                        return;
                    }
                    setState({
                        query,
                        suggestions: result.users,
                        hasMore: result.hasMore,
                        hasError: false,
                        // A fresh set of names starts at the top: the index that was
                        // active pointed into a list that no longer exists.
                        activeIndex: 0,
                    });
                } catch {
                    if (cancelled) {
                        return;
                    }
                    // The error itself is deliberately not logged: a lookup failure
                    // can carry environment details with it.
                    setState({
                        query,
                        suggestions: NO_SUGGESTIONS,
                        hasMore: false,
                        hasError: true,
                        activeIndex: 0,
                    });
                }
            })();
        }, MENTION_SEARCH_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    const setActiveIndex = React.useCallback((index: number) => {
        setState((current) => ({ ...current, activeIndex: index }));
    }, []);

    // Only state that answers the query being asked may be shown.
    const answersCurrentQuery = state.query === query;

    return React.useMemo(
        () => ({
            suggestions: answersCurrentQuery ? state.suggestions : NO_SUGGESTIONS,
            hasMore: answersCurrentQuery ? state.hasMore : false,
            hasError: answersCurrentQuery ? state.hasError : false,
            // Searching from the keystroke onwards, including the debounce window:
            // something is on its way for as long as the held state is older than
            // the query.
            isSearching: query !== null && !answersCurrentQuery,
            activeIndex: answersCurrentQuery ? state.activeIndex : 0,
            setActiveIndex,
        }),
        [answersCurrentQuery, query, state, setActiveIndex]
    );
}
