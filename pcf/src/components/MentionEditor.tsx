import * as React from "react";
import {
    MessageBar,
    MessageBarBody,
    Spinner,
    Text,
    Textarea,
    makeStyles,
    tokens,
} from "@fluentui/react-components";

import { SuggestionList } from "./SuggestionList";
import {
    applyMention,
    findMentionTrigger,
    mentionDeletionRange,
    reanchorMentions,
} from "../domain/mentionText";
import type { InsertedMention, MentionTrigger } from "../domain/mentionText";
import { sameMentionOccurrences } from "../domain/mentionLifecycle";
import type { MentionOccurrence } from "../domain/mentionLifecycle";
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
    /** Shown in place of the value when the column may not be read. */
    readonly maskedValue: string;
    /** Explains that mentioning needs a connection. */
    readonly offlineNotice: string;
    /** How many characters the column still has room for. */
    readonly charactersLeft: (remaining: number) => string;
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
    maskedValue: "* * * * *",
    offlineNotice: "No connection. Mentioning is unavailable while offline.",
    charactersLeft: (remaining) => `${remaining.toString()} characters left`,
};

export interface MentionEditorProps {
    readonly value: string;
    readonly disabled: boolean;
    readonly maxLength?: number | undefined;
    /** Gives the textarea an accessible name. */
    readonly label?: string | undefined;
    readonly placeholder?: string | undefined;
    readonly userSearchProvider: UserSearchProvider;
    /**
     * Called once for each edit the user makes, with the text and the mentions
     * standing in it **at the same instant**.
     *
     * One edit, one call, and both halves are already settled when it happens.
     * They are two views of one state, and a caller that has to write them out
     * together — a host that saves text and mention identity in one record —
     * must never be handed one of them a moment before the other.
     *
     * Not called when a host value is taken over: that is not the user editing.
     */
    readonly onLocalEdit: (state: MentionEditorState) => void;
    /**
     * Called when the editor takes a value decided by the host over, with the
     * state that value leaves behind. A host value can take a mention out from
     * under the editor, so this is where a caller learns that it is gone.
     */
    readonly onHostValueAdopted?: ((state: MentionEditorState) => void) | undefined;
    readonly strings?: MentionEditorStrings | undefined;
    /** Overridable so several editors on one form do not share element ids. */
    readonly listboxId?: string | undefined;
    /**
     * False when this editor may show text but must not create a mention.
     *
     * The identity of a mention has to be written somewhere for it to mean
     * anything later; where the host will not accept it, offering the picker
     * would produce a mention that silently means nobody. Typing is unaffected.
     */
    readonly canMention?: boolean | undefined;
    /**
     * True when the host says this column may not be read. The value is then
     * never shown, never put into the DOM, and nothing about it is editable —
     * a masked column is masked, not merely greyed out.
     */
    readonly masked?: boolean | undefined;
    /**
     * Set when mentioning is unavailable for a reason worth telling the user
     * about. It is shown, and the picker stays shut while it is there.
     */
    readonly notice?: string | undefined;
}

/** What the editor holds right now: the text, and who is mentioned in it. */
export interface MentionEditorState {
    readonly text: string;
    /** In text order, and a fresh copy every time. */
    readonly mentions: readonly MentionOccurrence[];
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
    footer: {
        alignItems: "baseline",
        columnGap: tokens.spacingHorizontalS,
        display: "flex",
        flexWrap: "wrap",
    },
    counter: {
        color: tokens.colorNeutralForeground3,
        marginInlineStart: "auto",
    },
    masked: {
        color: tokens.colorNeutralForeground3,
        display: "block",
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
 * A mention this editor wrote, plus what the suggestion that created it carried.
 *
 * The extra data belongs to the *occurrence*, not to the person: the same user
 * may be picked twice from suggestions that differ, and a later pick must never
 * rewrite what an earlier occurrence recorded.
 */
interface TrackedMention extends InsertedMention {
    readonly email?: string | undefined;
}

/** Keeps snapshots in text order, so an unchanged set always compares equal. */
function byStart(left: TrackedMention, right: TrackedMention): number {
    return left.start - right.start;
}

/** A copy with no shared references, so two snapshots can never alias. */
function copyOccurrence(occurrence: MentionOccurrence): MentionOccurrence {
    return occurrence.email === undefined
        ? { start: occurrence.start, name: occurrence.name, userId: occurrence.userId }
        : {
              start: occurrence.start,
              name: occurrence.name,
              userId: occurrence.userId,
              email: occurrence.email,
          };
}

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
    const { userSearchProvider, value } = props;
    const strings = props.strings ?? DEFAULT_MENTION_EDITOR_STRINGS;
    const listboxId = props.listboxId ?? DEFAULT_LISTBOX_ID;
    const optionId = React.useCallback(
        (index: number): string => `${listboxId}-option-${index.toString()}`,
        [listboxId]
    );

    const [text, setText] = React.useState(value);
    /**
     * The text on screen right now. Held in a ref so the reconciliation effect
     * can consult it without listing it as a dependency: re-running that effect
     * on every keystroke would resurrect a waiting host value that the very
     * keystroke had just superseded.
     */
    const textRef = React.useRef(text);
    textRef.current = text;
    const [trigger, setTrigger] = React.useState<MentionTrigger | null>(null);
    const [message, setMessage] = React.useState<string | undefined>(undefined);

    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const isFocused = React.useRef(false);
    const pendingCaret = React.useRef<number | null>(null);

    /** Where this editor wrote a mention, so typing on past one is not a new query. */
    const insertedMentions = React.useRef<TrackedMention[]>([]);
    /**
     * The text those positions were measured against. Moving them needs the edit
     * itself, not just its result: two people of the same name leave two identical
     * mentions, and only the change says which of them was deleted.
     */
    const anchoredText = React.useRef(value);
    const reanchor = React.useCallback((next: string): TrackedMention[] => {
        insertedMentions.current = reanchorMentions(insertedMentions.current, anchoredText.current, next);
        anchoredText.current = next;
        return insertedMentions.current;
    }, []);

    // Held in refs so a caller passing inline callbacks does not change the
    // identity of everything downstream on every render.
    const onLocalEditRef = React.useRef(props.onLocalEdit);
    onLocalEditRef.current = props.onLocalEdit;
    const onHostValueAdoptedRef = React.useRef(props.onHostValueAdopted);
    onHostValueAdoptedRef.current = props.onHostValueAdopted;

    /** The last set that was handed out, so an unchanged set is not reported again. */
    const reportedMentions = React.useRef<readonly MentionOccurrence[]>([]);

    const toOccurrence = React.useCallback(
        (mention: TrackedMention): MentionOccurrence =>
            mention.email === undefined
                ? { start: mention.start, name: mention.name, userId: mention.userId }
                : {
                      start: mention.start,
                      name: mention.name,
                      userId: mention.userId,
                      email: mention.email,
                  },
        []
    );

    /**
     * The mentions standing in the text right now, as the caller's own objects.
     *
     * What is handed out must never be what the next comparison reads:
     * `readonly` is a compile-time promise, and ordinary JavaScript can still
     * write through it.
     */
    const mentionSnapshot = React.useCallback((): readonly MentionOccurrence[] => {
        const snapshot = insertedMentions.current.map(toOccurrence);
        reportedMentions.current = snapshot;
        return snapshot.map(copyOccurrence);
    }, [toOccurrence]);

    /** True when the recorded mentions differ from the ones last handed out. */
    const mentionsChanged = React.useCallback(
        () =>
            !sameMentionOccurrences(
                reportedMentions.current,
                insertedMentions.current.map(toOccurrence)
            ),
        [toOccurrence]
    );

    // A disabled field offers nobody, a field that may not record a mention
    // offers nobody, a field whose notice explains why mentioning is off offers
    // nobody, and a query is only ever what the caret is on. Nothing is looked
    // up in any of those cases: the query stays null, so no request is made.
    const mayMention = props.canMention !== false && props.notice === undefined;
    const query = props.disabled || !mayMention ? null : (trigger?.query ?? null);
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
            const changed = mentionsChanged();
            const state: MentionEditorState = { text: next, mentions: mentionSnapshot() };
            emittedValues.current = new Set<string>([next]);
            pendingHostValue.current = null;
            // A host value can take a mention out from under the editor, and the
            // caller has to hear about that. Silence when nothing moved: the host
            // deciding on text is not by itself news about who is mentioned.
            if (changed) {
                onHostValueAdoptedRef.current?.(state);
            }
        },
        [mentionSnapshot, mentionsChanged, reanchor]
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
     * 6. When the host reports exactly what the editor already shows, the two
     *    agree. That is an acknowledgement point, and the older emitted values
     *    are forgotten: past that point they can no longer be told apart from a
     *    genuine host decision, so keeping them would make a value the editor
     *    once emitted impossible for the host to ever set again.
     */
    React.useEffect(() => {
        if (value === textRef.current) {
            emittedValues.current = new Set<string>([value]);
            pendingHostValue.current = null;
            return;
        }
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

    /**
     * Takes one edit the user made and hands it on as a single state.
     *
     * The order here is the contract: the anchors are put right, the mentions
     * are read off, and only then is anybody told. A caller that learns the text
     * first would, for one moment, hold a text that names somebody and a mention
     * set that does not — and a host that saves in that moment saves the two
     * halves disagreeing.
     */
    const commitLocalEdit = React.useCallback(
        (next: string) => {
            setText(next);
            emittedValues.current.add(next);
            // Rule 3: this edit happened after any host value still waiting, so
            // that value is no longer the newer of the two.
            pendingHostValue.current = null;
            onLocalEditRef.current({ text: next, mentions: mentionSnapshot() });
        },
        [mentionSnapshot]
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
            // back where they now sit before they are consulted. Nobody is told
            // here: moving the caret changes no mention, and an edit is reported
            // once, by the commit that follows this.
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
            // Anchors and picker first, so the mentions are already where the new
            // text puts them when the edit is handed on as one state.
            syncTrigger(data.value, caret, true);
            commitLocalEdit(data.value);
        },
        [commitLocalEdit, syncTrigger]
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

            const pickedEmail = (user.email ?? "").trim();
            // The address is recorded on this occurrence, not against the user:
            // picking the same person again later, from a suggestion that carries
            // something different, must not rewrite what this one recorded.
            const written: TrackedMention =
                pickedEmail.length > 0
                    ? {
                          start: trigger.start,
                          name: user.name.trim(),
                          userId: user.id,
                          email: pickedEmail,
                      }
                    : { start: trigger.start, name: user.name.trim(), userId: user.id };
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
                // Text order, always. The new mention may belong before the ones
                // already recorded, and an unchanged set must keep comparing
                // equal rather than look changed because the order shifted.
            ].sort(byStart);

            pendingCaret.current = result.caret;
            closeSuggestions();
            // Handed on only once the mention is actually in the text, and with
            // the text it is in: a refused or impossible selection must look like
            // nothing happened at all.
            commitLocalEdit(result.text);
        },
        [
            closeSuggestions,
            commitLocalEdit,
            props.maxLength,
            reanchor,
            strings.mentionTooLong,
            text,
            trigger,
        ]
    );

    const handleKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // A mention is deleted whole. The key itself is left to the textarea:
            // selecting the range and letting the browser remove it keeps the step
            // in the field's own undo history, so Ctrl+Z brings the name back. This
            // runs before the picker's keys, and while no picker is open at all —
            // which is the ordinary state of a name picked a while ago.
            if (event.key === "Backspace" || event.key === "Delete") {
                const element = event.currentTarget;
                const caret = element.selectionStart ?? 0;
                // A selection already says what is to go; only a bare caret is
                // ambiguous about what the key means.
                const range =
                    caret === element.selectionEnd
                        ? mentionDeletionRange(
                              element.value,
                              caret,
                              event.key === "Backspace" ? "backward" : "forward",
                              insertedMentions.current
                          )
                        : null;
                if (range !== null) {
                    element.setSelectionRange(range.start, range.end);
                    return;
                }
            }

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

    // A column the host will not let this user read shows nothing of its value:
    // not in the field, not in the DOM, not in any attribute. Every hook above
    // has already run, so the component's shape does not change between renders.
    if (props.masked === true) {
        return (
            <div className={styles.root}>
                <Text aria-label={props.label} className={styles.masked} size={300}>
                    {strings.maskedValue}
                </Text>
            </div>
        );
    }

    const isOpen = trigger !== null && !props.disabled && mayMention && !hasError;
    const isListRendered = isOpen && !(isSearching && suggestions.length === 0);
    const hasActiveOption = isListRendered && suggestions.length > 0;
    const counterId = `${listboxId}-characters-left`;
    const remaining = props.maxLength === undefined ? undefined : props.maxLength - text.length;
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
                    // Named rather than announced on every keystroke: a live
                    // region would read the count out after each letter.
                    "aria-describedby": remaining === undefined ? undefined : counterId,
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

            <div className={styles.footer}>
                {props.notice !== undefined ? (
                    <MessageBar intent="info" politeness="polite">
                        <MessageBarBody>{props.notice}</MessageBarBody>
                    </MessageBar>
                ) : null}

                {hasError || message !== undefined ? (
                    <MessageBar intent="warning" politeness="polite">
                        <MessageBarBody>
                            {hasError ? strings.lookupFailed : message}
                        </MessageBarBody>
                    </MessageBar>
                ) : null}

                {remaining === undefined ? null : (
                    <Text className={styles.counter} id={counterId} size={200}>
                        {strings.charactersLeft(remaining)}
                    </Text>
                )}
            </div>
        </div>
    );
};
