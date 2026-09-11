import * as React from "react";
import { MessageBar, MessageBarBody, Spinner, Textarea, makeStyles, tokens } from "@fluentui/react-components";

import { SuggestionList } from "./SuggestionList";
import { applyMention, findMentionTrigger, reanchorMentions } from "../domain/mentionText";
import type { InsertedMention, MentionTrigger } from "../domain/mentionText";
import type { UserSearchProvider, UserSuggestion } from "../domain/userSearch";
import { useMentionSearch } from "../hooks/useMentionSearch";

export interface MentionEditorStrings {
    readonly noResults: string;
    readonly searching: string;
    /** Neutral wording: a lookup failure must never surface the underlying error. */
    readonly lookupFailed: string;
    readonly mentionTooLong: string;
    readonly moreResults: string;
    readonly suggestionsAvailable: (count: number) => string;
}

/**
 * Neutral English defaults. A host that localises passes its own strings; nothing
 * here is customer- or environment-specific.
 */
export const DEFAULT_MENTION_EDITOR_STRINGS: MentionEditorStrings = {
    noResults: "No people found",
    searching: "Searching people",
    lookupFailed: "People could not be looked up. Please try again.",
    mentionTooLong: "The mention does not fit within the remaining characters.",
    moreResults: "More results available. Keep typing to narrow them down.",
    suggestionsAvailable: (count) =>
        count === 1 ? "1 suggestion available" : `${count.toString()} suggestions available`,
};

export interface MentionEditorProps {
    readonly value: string;
    readonly disabled: boolean;
    readonly maxLength?: number | undefined;
    /** Gives the textarea an accessible name. */
    readonly label?: string | undefined;
    readonly placeholder?: string | undefined;
    readonly userSearchProvider: UserSearchProvider;
    readonly onChange: (value: string) => void;
    readonly strings?: MentionEditorStrings | undefined;
    /** Overridable so several editors on one form do not share element ids. */
    readonly listboxId?: string | undefined;
}

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        rowGap: tokens.spacingVerticalXS,
        width: "100%",
    },
    textarea: {
        maxWidth: "100%",
        minWidth: 0,
        width: "100%",
    },
    // Announced, never shown: the list itself must stay free of anything that is
    // not a person to pick.
    srOnly: {
        clipPath: "inset(50%)",
        height: "1px",
        overflow: "hidden",
        position: "absolute",
        whiteSpace: "nowrap",
        width: "1px",
    },
});

const DEFAULT_LISTBOX_ID = "ayonto-mention-suggestions";

/**
 * A textarea that offers people when an "@" is typed.
 *
 * The host is expected to provide a Fluent `FluentProvider`; this component draws
 * with Fluent primitives but does not choose a theme.
 *
 * The popup is rendered in normal flow below the field. Portalling and viewport
 * measurement are deliberately left out for now, so this component needs no
 * window listeners and never walks the host's DOM.
 */
export const MentionEditor: React.FC<MentionEditorProps> = (props) => {
    const styles = useStyles();
    const { onChange, userSearchProvider, value } = props;
    const strings = props.strings ?? DEFAULT_MENTION_EDITOR_STRINGS;
    const listboxId = props.listboxId ?? DEFAULT_LISTBOX_ID;
    const optionId = React.useCallback(
        (index: number): string => `${listboxId}-option-${index.toString()}`,
        [listboxId]
    );

    const [text, setText] = React.useState(value);
    const [trigger, setTrigger] = React.useState<MentionTrigger | null>(null);
    const [message, setMessage] = React.useState<string | undefined>(undefined);

    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const isFocused = React.useRef(false);
    const pendingCaret = React.useRef<number | null>(null);

    /** Where this editor wrote a mention, so typing on past one is not a new query. */
    const insertedMentions = React.useRef<InsertedMention[]>([]);
    /**
     * The text those positions were measured against. Moving them needs the edit
     * itself, not just its result: two people of the same name leave two identical
     * mentions, and only the change says which of them was deleted.
     */
    const anchoredText = React.useRef(value);
    const reanchor = React.useCallback((next: string): InsertedMention[] => {
        insertedMentions.current = reanchorMentions(insertedMentions.current, anchoredText.current, next);
        anchoredText.current = next;
        return insertedMentions.current;
    }, []);

    // A disabled field offers nobody, and a query is only ever what the caret is on.
    const query = props.disabled ? null : (trigger?.query ?? null);
    const search = useMentionSearch(query, userSearchProvider);
    const { activeIndex, hasError, hasMore, isSearching, setActiveIndex, suggestions } = search;

    /**
     * Every text this editor has handed to the host since it last took a host
     * value over. The host echoes what it is given, sometimes late and sometimes
     * behind by an edit or two, and such an echo carries no new information — it
     * must never be mistaken for the host deciding on a value of its own. The set
     * holds one short string per committed keystroke of the current editing run
     * and is emptied whenever a host value is adopted.
     */
    const emittedValues = React.useRef<Set<string>>(new Set<string>([value]));
    /** A genuine host value that arrived mid-edit and is waiting for editing to end. */
    const pendingHostValue = React.useRef<string | null>(null);

    /** Takes a host value over wholesale: text, anchors and bookkeeping. */
    const adoptHostValue = React.useCallback(
        (next: string) => {
            setText(next);
            reanchor(next);
            emittedValues.current = new Set<string>([next]);
            pendingHostValue.current = null;
        },
        [reanchor]
    );

    /**
     * Reconciliation policy, stated once so nothing depends on an effect happening
     * to re-run:
     *
     * 1. Anything the host sends that this editor has already emitted is an echo.
     *    It is dropped outright, which is what keeps a late echo of an earlier
     *    keystroke from reverting newer local text.
     * 2. A value the editor never emitted is the host deciding for itself. While
     *    the field is being edited it is only remembered, never applied, because
     *    applying it would move the caret out from under the typing.
     * 3. Any local edit supersedes a host value that is still waiting, since the
     *    person editing acted after it arrived.
     * 4. What is still waiting when editing ends is applied then — that is the
     *    convergence step, and it is driven explicitly from the blur handler
     *    rather than by an effect firing again.
     * 5. While the field is not being edited, a host value applies at once.
     */
    React.useEffect(() => {
        if (emittedValues.current.has(value)) {
            return;
        }
        if (isFocused.current) {
            pendingHostValue.current = value;
            return;
        }
        adoptHostValue(value);
    }, [adoptHostValue, value]);

    // Puts the caret back after a mention was written into the text.
    React.useEffect(() => {
        const caret = pendingCaret.current;
        if (caret !== null && textareaRef.current !== null) {
            textareaRef.current.setSelectionRange(caret, caret);
            pendingCaret.current = null;
        }
    });

    const closeSuggestions = React.useCallback(() => {
        setTrigger(null);
        setMessage(undefined);
    }, []);

    const commit = React.useCallback(
        (next: string) => {
            setText(next);
            emittedValues.current.add(next);
            // Rule 3: this edit happened after any host value still waiting, so
            // that value is no longer the newer of the two.
            pendingHostValue.current = null;
            onChange(next);
        },
        [onChange]
    );

    /** Rule 4: editing has ended, so whatever the host decided may now apply. */
    const handleBlur = React.useCallback(() => {
        isFocused.current = false;
        closeSuggestions();
        const pending = pendingHostValue.current;
        if (pending !== null) {
            adoptHostValue(pending);
        }
    }, [adoptHostValue, closeSuggestions]);

    /**
     * Keeps the open mention in step with the caret.
     *
     * `mayOpen` is false for a plain caret move. Letting a click or an arrow key
     * open the list on text that is already there turns an ordinary Enter into an
     * overwrite of a finished mention. Moving the caret may therefore only ever
     * close the list; typing is what opens it.
     */
    const syncTrigger = React.useCallback(
        (nextText: string, caret: number, mayOpen: boolean) => {
            // Editing in front of a mention moves it, so the recorded ones are put
            // back where they now sit before they are consulted.
            reanchor(nextText);
            const found = findMentionTrigger(nextText, caret);

            // A query may hold a space because names do, so carrying the sentence on
            // after a one-word mention ("@Dana thanks") still looks like a query. It
            // is not: the name is already there. Only a mention written at that exact
            // spot counts — a later "@Dana Winter" typed elsewhere is a query like
            // any other and must still open the list.
            const continuesInsertedMention =
                found !== null &&
                insertedMentions.current.some(
                    (mention) =>
                        mention.start === found.start && found.query.startsWith(`${mention.name} `)
                );
            const next = continuesInsertedMention ? null : found;

            setTrigger((current) => {
                if (current === null) {
                    return mayOpen ? next : null;
                }
                if (next === null) {
                    return null;
                }
                // A caret move may follow the mention it is already on, never jump to
                // another one: re-aiming the picker at a finished mention elsewhere
                // would let the next Enter overwrite it.
                if (!mayOpen && next.start !== current.start) {
                    return null;
                }
                if (
                    current.start === next.start &&
                    current.end === next.end &&
                    current.query === next.query
                ) {
                    return current;
                }
                return next;
            });
        },
        [reanchor]
    );

    const handleChange = React.useCallback(
        (event: React.ChangeEvent<HTMLTextAreaElement>, data: { value: string }) => {
            const caret = event.target.selectionStart ?? data.value.length;
            setMessage(undefined);
            commit(data.value);
            syncTrigger(data.value, caret, true);
        },
        [commit, syncTrigger]
    );

    // React derives onSelect from its own heuristics, so the caret is read from the
    // plain events that always fire when it can move.
    const handleCaretMove = React.useCallback(
        (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
            const element = event.currentTarget;
            syncTrigger(element.value, element.selectionStart ?? element.value.length, false);
        },
        [syncTrigger]
    );

    const select = React.useCallback(
        (user: UserSuggestion) => {
            if (trigger === null) {
                return;
            }

            const result = applyMention(text, trigger, user.name);
            if (props.maxLength !== undefined && result.text.length > props.maxLength) {
                // Closing clears any standing message, so the reason is set after it.
                closeSuggestions();
                setMessage(strings.mentionTooLong);
                return;
            }

            const written: InsertedMention = {
                start: trigger.start,
                name: user.name.trim(),
                userId: user.id,
            };
            const writtenEnd = written.start + written.name.length + 1;
            insertedMentions.current = [
                // The new mention takes the space the query stood in, so anything
                // recorded there speaks for a person the text no longer names.
                ...reanchor(result.text).filter(
                    (mention) =>
                        mention.start + mention.name.length + 1 <= written.start ||
                        mention.start >= writtenEnd
                ),
                written,
            ];

            pendingCaret.current = result.caret;
            commit(result.text);
            closeSuggestions();
        },
        [closeSuggestions, commit, props.maxLength, reanchor, strings.mentionTooLong, text, trigger]
    );

    const handleKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // The Enter that commits an IME candidate must not pick a suggestion.
            if (trigger === null || event.nativeEvent.isComposing) {
                return;
            }

            switch (event.key) {
                case "ArrowDown":
                    if (suggestions.length > 0) {
                        event.preventDefault();
                        setActiveIndex((activeIndex + 1) % suggestions.length);
                    }
                    break;
                case "ArrowUp":
                    if (suggestions.length > 0) {
                        event.preventDefault();
                        setActiveIndex((activeIndex - 1 + suggestions.length) % suggestions.length);
                    }
                    break;
                case "Enter":
                case "Tab": {
                    const active = suggestions[activeIndex];
                    if (active !== undefined) {
                        event.preventDefault();
                        select(active);
                    }
                    break;
                }
                case "Escape":
                    event.preventDefault();
                    closeSuggestions();
                    break;
                default:
                    break;
            }
        },
        [activeIndex, closeSuggestions, select, setActiveIndex, suggestions, trigger]
    );

    const isOpen = trigger !== null && !props.disabled && !hasError;
    const isListRendered = isOpen && !(isSearching && suggestions.length === 0);
    const hasActiveOption = isListRendered && suggestions.length > 0;
    const status = hasError
        ? strings.lookupFailed
        : isOpen && isSearching
          ? strings.searching
          : isListRendered
            ? strings.suggestionsAvailable(suggestions.length)
            : "";

    return (
        <div className={styles.root}>
            <Textarea
                appearance="outline"
                className={styles.textarea}
                disabled={props.disabled}
                onBlur={handleBlur}
                onChange={handleChange}
                onFocus={() => {
                    isFocused.current = true;
                }}
                onKeyDown={handleKeyDown}
                placeholder={props.placeholder}
                resize="vertical"
                textarea={{
                    // The textarea is the combobox input: it owns the popup and names
                    // the active option, while the list itself carries the options.
                    "aria-activedescendant": hasActiveOption ? optionId(activeIndex) : undefined,
                    "aria-autocomplete": "list",
                    "aria-controls": isListRendered ? listboxId : undefined,
                    "aria-expanded": isOpen,
                    "aria-label": props.label,
                    maxLength: props.maxLength,
                    onClick: handleCaretMove,
                    onKeyUp: handleCaretMove,
                    ref: textareaRef,
                    role: "combobox",
                }}
                value={text}
            />

            {/* Announced, not offered: never an option in the list. */}
            <div aria-live="polite" className={styles.srOnly} role="status">
                {status}
            </div>

            {isOpen && isSearching && suggestions.length === 0 ? (
                <Spinner label={strings.searching} labelPosition="after" size="tiny" />
            ) : null}

            {isListRendered ? (
                <SuggestionList
                    activeIndex={activeIndex}
                    emptyLabel={strings.noResults}
                    id={listboxId}
                    moreLabel={hasMore ? strings.moreResults : undefined}
                    onHover={setActiveIndex}
                    onSelect={select}
                    optionId={optionId}
                    suggestions={suggestions}
                />
            ) : null}

            {hasError || message !== undefined ? (
                <MessageBar intent="warning" politeness="polite">
                    <MessageBarBody>{hasError ? strings.lookupFailed : message}</MessageBarBody>
                </MessageBar>
            ) : null}
        </div>
    );
};
