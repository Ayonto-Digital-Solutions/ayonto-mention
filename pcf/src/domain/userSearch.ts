/**
 * Platform-neutral contract for looking people up so they can be mentioned.
 *
 * Nothing here knows about Dataverse, the Power Apps component framework or any
 * other host: the editor depends on this contract, an adapter in `../services`
 * fulfils it, and a test double can stand in for that adapter without pulling a
 * platform into the test.
 */

/** One person the editor may offer, as far as the picker needs to know them. */
export interface UserSuggestion {
    /** Stable identity of the person. Never the display name — two people can share one. */
    readonly id: string;
    /** The name shown in the picker and written into the text. */
    readonly name: string;
    /**
     * Declared `string | undefined` rather than a plain optional so an adapter may
     * pass through a value it did not find; `exactOptionalPropertyTypes` rejects
     * writing `undefined` to a plain optional.
     */
    readonly email?: string | undefined;
    readonly jobTitle?: string | undefined;
}

export interface UserSearchResult {
    readonly users: readonly UserSuggestion[];
    /** True when the source had more matches than were returned. */
    readonly hasMore: boolean;
}

/** Anything that can answer "who matches what the user typed". */
export interface UserSearchProvider {
    search(term: string): Promise<UserSearchResult>;
}

/**
 * Looks one known user up by id.
 *
 * Used to check that a mention a record carried still shows the person it was
 * recorded for. The name that comes back is compared with the one standing in
 * the text; it is never stored, and never used to decide who a mention means.
 */
export interface UserDirectory {
    /** The display name Dataverse holds, or null when there is no such user. */
    resolveName(userId: string): Promise<string | null>;
}
