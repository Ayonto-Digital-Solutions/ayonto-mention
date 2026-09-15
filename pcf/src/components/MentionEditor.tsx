import * as React from "react";
import {
    Avatar,
    InteractionTag,
    InteractionTagPrimary,
    MessageBar,
    MessageBarBody,
    Popover,
    PopoverSurface,
    Spinner,
    Text,
    Textarea,
    makeStyles,
    mergeClasses,
    tokens,
} from "@fluentui/react-components";
import type { PositioningProps } from "@fluentui/react-components";

import { SuggestionList } from "./SuggestionList";
import {
    applyMention,
    findMentionTrigger,
    mentionDeletionRange,
    reanchorMentions,
    splitTrackedMentions,
} from "../domain/mentionText";
import type { InsertedMention, MentionTrigger } from "../domain/mentionText";
import { sameMentionOccurrences } from "../domain/mentionLifecycle";
import type { MentionOccurrence } from "../domain/mentionLifecycle";
import type { UserDirectory, UserSearchProvider, UserSuggestion } from "../domain/userSearch";
import { useMentionSearch } from "../hooks/useMentionSearch";

export interface MentionEditorStrings {
    /** Shown in the empty field. Never part of its value. */
    readonly placeholder: string;
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
    /** Names the button a mention becomes when it can be opened. */
    readonly openMentionedUser: (name: string) => string;
    /** How many characters the column still has room for. */
    readonly charactersLeft: (remaining: number) => string;
}

/**
 * Neutral English defaults. A host that localises passes its own strings; nothing
 * here is customer- or environment-specific.
 */
export const DEFAULT_MENTION_EDITOR_STRINGS: MentionEditorStrings = {
    placeholder: "Type @ to mention someone",
    noResults: "No people found",
    searching: "Searching people",
    lookupFailed: "People could not be looked up. Please try again.",
    mentionTooLong: "The mention does not fit within the remaining characters.",
    moreResults: "More results available. Keep typing to narrow them down.",
    suggestionsAvailable: (count) =>
        count === 1 ? "1 suggestion available" : `${count.toString()} suggestions available`,
    maskedValue: "* * * * *",
    offlineNotice: "No connection. Mentioning is unavailable while offline.",
    openMentionedUser: (name) => `Open ${name}`,
    charactersLeft: (remaining) => `${remaining.toString()} characters left`,
};

/** A host state waiting to be taken up: text, the identities in it, and which one it is. */
interface ParkedHostState {
    readonly text: string;
    readonly mentions: readonly MentionOccurrence[];
    readonly revision: number | undefined;
}

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
    /**
     * The mentions a saved record already carried, validated by the caller. Read
     * once, when this editor mounts: identity belongs to the record, and the
     * editor is not the place that decides what a stored payload was worth.
     */
    readonly initialMentions?: readonly MentionOccurrence[] | undefined;
    /**
     * Looks a user up by id, so a mention a record carried can be shown to name
     * the person it was recorded for — and can be left as ordinary text when
     * that cannot be confirmed.
     */
    readonly userDirectory?: UserDirectory | undefined;
    /**
     * False while the environment cannot be asked who a recorded mention names.
     *
     * A plain capability, decided by the caller: this editor does not know what
     * a Dataverse is, let alone whether one is reachable. Left out, the caller
     * is not saying, and the directory is asked.
     */
    readonly canVerifyPersistedMentions?: boolean | undefined;
    /**
     * Names the host state `value` and `initialMentions` belong to, changing
     * only when the caller has taken up a genuinely new one.
     *
     * Text and identities arrive as one thing and are adopted as one thing. The
     * text on its own cannot say whether that happened: the very same sentence
     * can be saved again by somebody else meaning a different person, and an
     * editor comparing strings would see nothing to do and go on showing — and
     * on the next edit, writing back — the person who is no longer there.
     */
    readonly hostRevision?: number | undefined;
    /**
     * Opens the person a mention names. Without it the mentions still read as
     * mentions; they are simply not something to click.
     */
    readonly onOpenUser?: ((userId: string) => void) | undefined;
}

/** What the editor holds right now: the text, and who is mentioned in it. */
export interface MentionEditorState {
    readonly text: string;
    /** In text order, and a fresh copy every time. */
    readonly mentions: readonly MentionOccurrence[];
}

/**
 * Where the suggestion list goes, relative to the field it belongs to.
 *
 * Below it, aligned to its leading edge, a hair of space between the two, as
 * wide as the field, and kept inside the viewport with a small margin. Fixed
 * positioning is what lets the list escape a form pane that clips or scrolls
 * its contents, which is the whole reason it is not simply drawn after the
 * field in the document.
 *
 * Stated once, as data, so it can be read — by the next person, and by a test —
 * without following it through a render. Everything it asks for is worked out
 * by Fluent: this component measures nothing.
 */
export const MENTION_POPUP_POSITIONING: PositioningProps = {
    align: "start",
    flipBoundary: "window",
    matchTargetSize: "width",
    offset: 2,
    overflowBoundary: "window",
    overflowBoundaryPadding: 8,
    position: "below",
    strategy: "fixed",
};

const useStyles = makeStyles({
    /**
     * The positioned surface the suggestions are drawn on.
     *
     * Fluent draws a card here — background, border, rounded corners, a drop
     * shadow and 16px of padding — and the list already is that card. Everything
     * visible is turned off, so the surface is nothing but a place in the
     * viewport to put the list, and the list is what the user sees.
     *
     * The width rules recreate the legacy control's proportions without asking
     * the browser how big the viewport is: Fluent matches the field's width, the
     * minimum keeps a narrow field from producing an unreadably narrow list, and
     * the maximum keeps the list off the edges of a small screen.
     */
    surface: {
        backgroundColor: "transparent",
        border: "none",
        borderRadius: 0,
        boxShadow: "none",
        filter: "none",
        maxWidth: "calc(100vw - 16px)",
        minWidth: "min(300px, calc(100vw - 16px))",
        padding: 0,
    },
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
    // Reads like the text it stands for: the same type, the same line height,
    // and the line breaks and runs of spaces the field actually holds.
    reader: {
        borderRadius: tokens.borderRadiusMedium,
        cursor: "text",
        fontFamily: tokens.fontFamilyBase,
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase500,
        minHeight: "32px",
        paddingBlock: tokens.spacingVerticalSNudge,
        paddingInline: tokens.spacingHorizontalMNudge,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    },
    readerDisabled: {
        color: tokens.colorNeutralForegroundDisabled,
        cursor: "default",
    },
    // The tag sits on a text line, so it may not push that line around.
    token: {
        verticalAlign: "middle",
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
    /**
     * The same element as `textareaRef`, kept in state as well.
     *
     * The suggestion list is positioned against the field itself, and a ref
     * cannot say when it arrives: the element exists only after the render that
     * created it, while the thing that has to be told about it — the positioned
     * surface — is decided during that render. A callback ref settles it, and
     * costs one extra render when the field appears or goes away.
     */
    const [targetElement, setTargetElement] = React.useState<HTMLTextAreaElement | null>(null);
    const setTextarea = React.useCallback((element: HTMLTextAreaElement | null) => {
        textareaRef.current = element;
        setTargetElement(element);
    }, []);

    const popupPositioning: PositioningProps = React.useMemo(
        () => ({ ...MENTION_POPUP_POSITIONING, target: targetElement }),
        [targetElement]
    );
    const isFocused = React.useRef(false);
    /**
     * True while the field is being worked in. A field at rest shows its
     * mentions as people; a field being edited shows the plain text that is
     * actually in it, because that is what the caret, undo and the clipboard
     * all work on.
     *
     * Typing counts as editing, not only focus: a change can reach this editor
     * without a focus event ever having been raised.
     */
    const [isEditing, setIsEditing] = React.useState(false);
    const pendingCaret = React.useRef<number | null>(null);

    /**
     * Where a mention stands, so typing on past one is not a new query — and so
     * a reader can be shown who it means.
     *
     * Seeded once from what the record carried. The caller has already decided
     * which of those are worth believing.
     */
    const insertedMentions = React.useRef<TrackedMention[]>([...(props.initialMentions ?? [])]);
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

    /**
     * The mentions that have been shown to name the person they were recorded
     * for, keyed by that person and the name standing in the text.
     *
     * A position is not proof. A record's payload says "the twelve characters at
     * six are user A", and an editor that never saw the text change cannot tell
     * whether those twelve characters still spell user A's name or somebody
     * else's — one save from another client is enough. So a mention only becomes
     * a person to press once Dataverse has confirmed that this id really is
     * called what the text says. Until then, and for good if it cannot be
     * confirmed, it stays ordinary text.
     */
    const [verified, setVerified] = React.useState<ReadonlySet<string>>(new Set<string>());
    /** What has already been asked about, so nothing is asked about twice. */
    const asked = React.useRef<Set<string>>(new Set<string>());
    /** False once this editor is gone, so no answer arrives at nothing. */
    const mounted = React.useRef(true);

    React.useEffect(
        () => () => {
            mounted.current = false;
        },
        []
    );

    /** The last set that was handed out, so an unchanged set is not reported again. */
    const reportedMentions = React.useRef<readonly MentionOccurrence[]>([]);

    /** One mention of one person: both halves matter, because names repeat. */
    const identityKey = React.useCallback(
        (mention: { userId: string; name: string }): string => `${mention.userId}\u0000${mention.name}`,
        []
    );

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

    /**
     * Asks Dataverse about every tracked mention that has not been confirmed yet.
     *
     * Runs after each render and does nothing on most of them: what has been
     * asked about once is never asked about again. A mention picked in this
     * session needs no round trip — the name in the text came from the entry the
     * user picked — so only what a record carried is looked up.
     *
     * Nothing here changes the value or the payload. Failing to confirm a
     * mention makes it read as ordinary text; it never edits the record.
     */
    React.useEffect(() => {
        const directory = props.userDirectory;
        // Nothing to ask with, or nothing to ask through. The recorded mentions
        // stay ordinary text and, crucially, stay *unasked*: a record opened
        // without a connection must become readable as people again when the
        // connection comes back, not for the rest of the session.
        if (directory === undefined || props.canVerifyPersistedMentions === false) {
            return;
        }

        const pending = insertedMentions.current.filter(
            (mention) => !asked.current.has(identityKey(mention))
        );

        for (const mention of pending) {
            const key = identityKey(mention);
            asked.current.add(key);
            void directory.resolveName(mention.userId).then((name) => {
                // Confirmed only when this id really is called what the text
                // says. Anything else — a different name, a deleted user, a
                // refused or unreachable read — leaves it as text.
                //
                // Only being gone cancels this. An answer is about one id and
                // one name, so it stays true however much the field has been
                // rendered in the meantime — and a question already asked is
                // never asked again, so dropping the answer would lose it.
                if (mounted.current && name !== null && name === mention.name) {
                    setVerified((current) => new Set(current).add(key));
                }
                return undefined;
            });
        }
    });

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
    /**
     * A genuine host value that arrived mid-edit and is waiting for editing to
     * end — together with the mentions that belong to *that* value.
     *
     * The two are one state. Taking the text without the identities recorded
     * for it would leave the editor showing one record's words with another
     * record's people attached to them.
     */
    const pendingHostValue = React.useRef<ParkedHostState | null>(null);
    /** The mentions the caller says belong to the value it is passing in. */
    const hostMentionsRef = React.useRef(props.initialMentions ?? []);
    hostMentionsRef.current = props.initialMentions ?? [];
    /**
     * The host state this editor is showing.
     *
     * State rather than a ref: adopting a pair whose text happens to be
     * unchanged still changes what is on screen — a different person behind the
     * same name — and nothing else would ask React to draw it.
     */
    const [adoptedRevision, setAdoptedRevision] = React.useState(props.hostRevision);
    /** The complete host state to take up, exactly as it arrived. */
    const hostState = React.useCallback(
        (): ParkedHostState => ({
            text: value,
            mentions: hostMentionsRef.current,
            revision: props.hostRevision,
        }),
        [props.hostRevision, value]
    );

    /** Takes a host state over wholesale: text, identities, anchors, bookkeeping. */
    const adoptHostValue = React.useCallback(
        ({ text: next, mentions, revision }: ParkedHostState) => {
            setText(next);
            // The identities recorded for this value replace whatever was
            // attached to the one before it, in the same step as the text.
            insertedMentions.current = mentions.map((mention) => ({ ...mention }));
            anchoredText.current = next;
            setAdoptedRevision(revision);
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
        [mentionSnapshot, mentionsChanged]
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
    /**
     * A masked field is not rendered, so nobody can be typing in it.
     *
     * Declared before the reconciliation below so the flag is already cleared
     * when it runs: a host value arriving while the field is masked would
     * otherwise be parked, waiting for a blur that can never come, and would
     * still be waiting when the field is shown again.
     */
    React.useEffect(() => {
        if (props.masked === true) {
            isFocused.current = false;
            setIsEditing(false);
        }
    }, [props.masked]);

    React.useEffect(() => {
        const revision = props.hostRevision;
        // A state the caller has taken up since the one on screen. It is new
        // whatever the text does — the caller has already decided that — so it
        // is checked before anything that reasons about the text.
        const isNewHostState = revision !== undefined && revision !== adoptedRevision;

        if (!isNewHostState) {
            if (value === textRef.current) {
                emittedValues.current = new Set<string>([value]);
                pendingHostValue.current = null;
                return;
            }
            if (emittedValues.current.has(value)) {
                return;
            }
        }

        if (isFocused.current && props.masked !== true) {
            // Whole, so that whenever it is applied it is applied as one thing.
            pendingHostValue.current = hostState();
            return;
        }
        adoptHostValue(hostState());
    }, [adoptHostValue, adoptedRevision, hostState, props.hostRevision, props.masked, value]);

    /**
     * Carries focus across the step from reading to editing.
     *
     * Reading and editing are two different renders: the tokens are not a
     * textarea, so the textarea the user is asking for does not exist yet at
     * the moment they ask for it. Without this, one click would put the field
     * into editing and leave focus nowhere — the user would have to click a
     * second time to type a character.
     */
    const focusOnEdit = React.useRef(false);

    React.useEffect(() => {
        const field = textareaRef.current;
        if (focusOnEdit.current && field !== null) {
            focusOnEdit.current = false;
            field.focus();
            // Reading ends where the text ends, which is where typing carries on.
            const end = field.value.length;
            field.setSelectionRange(end, end);
        }
    });

    /** Leaves reading for editing, with the caret in the field. */
    const beginEditing = React.useCallback(() => {
        focusOnEdit.current = true;
        setIsEditing(true);
    }, []);

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
            setIsEditing(true);
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
        setIsEditing(false);
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

            // The name in the text is the name of the entry that was picked, so
            // there is nothing left to confirm about this one.
            setVerified((current) => new Set(current).add(identityKey(written)));
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
            identityKey,
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

    const counterId = `${listboxId}-characters-left`;
    const remaining = props.maxLength === undefined ? undefined : props.maxLength - text.length;

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

    /**
     * A field at rest with mentions in it is shown as people rather than as the
     * characters that spell them. With nothing tracked there is nothing to draw,
     * so the field stays what it has always been — which also keeps a plain text
     * column behaving exactly as before.
     */
    const isReading = !isEditing && insertedMentions.current.length > 0;

    if (isReading) {
        const openUser = props.onOpenUser;
        return (
            <div className={styles.root}>
                <div
                    className={mergeClasses(
                        styles.reader,
                        props.disabled ? styles.readerDisabled : undefined
                    )}
                    aria-label={props.label}
                    // Reading is where editing starts, exactly as it does in an
                    // ordinary field: clicking the text puts the caret in it.
                    onClick={() => {
                        if (!props.disabled) {
                            beginEditing();
                        }
                    }}
                    // The same step without a mouse. Enter and Space are what a
                    // field at rest answers to, so a keyboard user reaches the
                    // text the same way and by the same keys.
                    onKeyDown={(event: React.KeyboardEvent) => {
                        if (props.disabled || (event.key !== "Enter" && event.key !== " ")) {
                            return;
                        }
                        // Space would otherwise scroll the form out from under
                        // the field it just opened.
                        event.preventDefault();
                        beginEditing();
                    }}
                    // A group rather than a textbox: it holds the tokens, which
                    // are reachable in their own right, and it is not itself
                    // something to type into.
                    role="group"
                    tabIndex={props.disabled ? -1 : 0}
                >
                    {splitTrackedMentions(text, insertedMentions.current).map((segment, index) => {
                        const mention = segment.mention;
                        // Not confirmed, not a person: the characters are shown
                        // as the text they are, and pressing them starts editing
                        // like any other part of the value.
                        return mention === undefined || !verified.has(identityKey(mention)) ? (
                            // Runs have no identity of their own: they are cut
                            // from the text afresh on every render.
                            <React.Fragment key={index}>{segment.text}</React.Fragment>
                        ) : (
                            <InteractionTag
                                appearance="brand"
                                // Two mentions of one person are two runs, and
                                // only their place tells them apart.
                                key={index}
                                shape="circular"
                                size="extra-small"
                            >
                                <InteractionTagPrimary
                                    aria-label={strings.openMentionedUser(
                                        segment.text.slice(1)
                                    )}
                                    className={styles.token}
                                    disabled={openUser === undefined}
                                    media={
                                        <Avatar
                                            // Decorative: the tag already carries the name.
                                            aria-hidden
                                            color="colorful"
                                            name={segment.text.slice(1)}
                                            size={16}
                                        />
                                    }
                                    onClick={(event: React.MouseEvent) => {
                                        // The click is the token's, not the
                                        // text's: it opens a person instead of
                                        // putting a caret behind them.
                                        event.stopPropagation();
                                        openUser?.(mention.userId);
                                    }}
                                >
                                    {segment.text.slice(1)}
                                </InteractionTagPrimary>
                            </InteractionTag>
                        );
                    })}
                </div>

                {remaining === undefined ? null : (
                    <div className={styles.footer}>
                        <Text className={styles.counter} size={200}>
                            {strings.charactersLeft(remaining)}
                        </Text>
                    </div>
                )}
            </div>
        );
    }

    const isOpen = trigger !== null && !props.disabled && mayMention && !hasError;
    const isListRendered = isOpen && !(isSearching && suggestions.length === 0);
    // A listbox exists only where there is something to pick. The note shown when
    // nobody matches is deliberately not one, so nothing may point at it as if it
    // were — neither `aria-controls` nor an active option.
    const hasListbox = isListRendered && suggestions.length > 0;
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
                    setIsEditing(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder={props.placeholder ?? strings.placeholder}
                resize="vertical"
                textarea={{
                    // The textarea is the combobox input: it owns the popup and names
                    // the active option, while the list itself carries the options.
                    "aria-activedescendant": hasListbox ? optionId(activeIndex) : undefined,
                    "aria-autocomplete": "list",
                    "aria-controls": hasListbox ? listboxId : undefined,
                    // Named rather than announced on every keystroke: a live
                    // region would read the count out after each letter.
                    "aria-describedby": remaining === undefined ? undefined : counterId,
                    "aria-expanded": isOpen,
                    "aria-label": props.label,
                    maxLength: props.maxLength,
                    onClick: handleCaretMove,
                    onKeyUp: handleCaretMove,
                    ref: setTextarea,
                    role: "combobox",
                }}
                value={text}
            />

            {/* Announced, not offered: never an option in the list. */}
            <div aria-live="polite" className={styles.srOnly} role="status">
                {status}
            </div>

            {/*
              * The suggestions are drawn against the field rather than after it
              * in the document. A field near the bottom of a form would
              * otherwise open its list into whatever the form does below it —
              * clipped by a scrolling pane, or simply off the screen.
              *
              * Fluent owns that problem. The list is portalled out of this
              * subtree and positioned against the textarea itself, which is
              * also what makes it follow the field when a form pane scrolls and
              * turn upwards when there is no room below. None of that is
              * measured here: this component never asks how big the viewport
              * is, never listens for a scroll, and never reads a rectangle.
              *
              * What is open stays this editor's decision. `open` is the state
              * the mention trigger already produces, and the callback Fluent
              * offers for dismissing itself is deliberately not taken: a second
              * opinion about when a list is open is how a list starts closing
              * under the person typing into it.
              */}
            <Popover
                open={isOpen}
                positioning={popupPositioning}
                // The list is not a dialog. Focus stays in the textarea, which
                // is what moves through the options and picks one; a surface
                // that focused itself would take the caret out of the sentence
                // being written.
                trapFocus={false}
                unstable_disableAutoFocus
            >
                <PopoverSurface className={styles.surface}>
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
                    ) : (
                        // The waiting state belongs in the same place the
                        // answer will appear, not under the field.
                        <Spinner label={strings.searching} labelPosition="after" size="tiny" />
                    )}
                </PopoverSurface>
            </Popover>

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
