import * as React from "react";
import { Avatar, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

import type { UserSuggestion } from "../domain/userSearch";

export interface SuggestionListProps {
    /** Id of the list element, so the editor can point `aria-controls` at it. */
    readonly id: string;
    readonly suggestions: readonly UserSuggestion[];
    /** Index of the option the editor currently treats as active. */
    readonly activeIndex: number;
    /**
     * Supplies the id of the option at an index. The parent owns these ids
     * because it is the one that has to name the active option in
     * `aria-activedescendant`.
     */
    readonly optionId: (index: number) => string;
    readonly onSelect: (user: UserSuggestion) => void;
    readonly onHover: (index: number) => void;
    readonly emptyLabel: string;
    /** Shown when the source had more matches than fit in the list. */
    readonly moreLabel?: string | undefined;
}

const useStyles = makeStyles({
    list: {
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        boxShadow: tokens.shadow16,
        listStyleType: "none",
        marginBlock: tokens.spacingVerticalXXS,
        maxHeight: "260px",
        overflowY: "auto",
        paddingInlineStart: 0,
        paddingBlock: tokens.spacingVerticalXXS,
    },
    option: {
        alignItems: "center",
        columnGap: tokens.spacingHorizontalS,
        cursor: "pointer",
        display: "flex",
        paddingBlock: tokens.spacingVerticalXS,
        paddingInline: tokens.spacingHorizontalS,
    },
    optionActive: {
        backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    optionText: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
    },
    secondary: {
        color: tokens.colorNeutralForeground3,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    empty: {
        color: tokens.colorNeutralForeground3,
        display: "block",
        paddingBlock: tokens.spacingVerticalXS,
        paddingInline: tokens.spacingHorizontalS,
    },
    more: {
        // Longhands: Griffel types "borderBlockStart" as never, since it does not
        // expand that shorthand.
        borderBlockStartColor: tokens.colorNeutralStroke2,
        borderBlockStartStyle: "solid",
        borderBlockStartWidth: "1px",
        color: tokens.colorNeutralForeground3,
        display: "block",
        marginBlockStart: tokens.spacingVerticalXXS,
        paddingBlock: tokens.spacingVerticalXS,
        paddingInline: tokens.spacingHorizontalS,
    },
});

/**
 * Renders the people the editor may offer.
 *
 * This component only draws and reports: it never searches, never decides which
 * option is active, and never writes a mention. The parent owns that state, and
 * the identity of a suggestion is always its `id` — two people can share a
 * display name, so the name is never used to tell them apart.
 */
export const SuggestionList: React.FC<SuggestionListProps> = (props) => {
    const styles = useStyles();
    const activeRef = React.useRef<HTMLLIElement | null>(null);

    React.useEffect(() => {
        // Keeps the active option in view while the editor moves through the list.
        activeRef.current?.scrollIntoView({ block: "nearest" });
    }, [props.activeIndex, props.suggestions]);

    if (props.suggestions.length === 0) {
        // Deliberately not a listbox: there is nothing to pick, so the note must
        // not read as an option.
        return (
            <div className={styles.list} id={props.id}>
                <Text className={styles.empty} size={200}>
                    {props.emptyLabel}
                </Text>
            </div>
        );
    }

    return (
        <ul
            className={styles.list}
            id={props.id}
            // A mousedown on the padding or the scrollbar would blur the editor and
            // close the list before the click can land.
            onMouseDown={(event) => {
                event.preventDefault();
            }}
            role="listbox"
        >
            {props.suggestions.map((user, index) => (
                <li
                    aria-selected={index === props.activeIndex}
                    className={mergeClasses(
                        styles.option,
                        index === props.activeIndex && styles.optionActive
                    )}
                    id={props.optionId(index)}
                    key={user.id}
                    // The editor keeps the focus, so the option is picked on mouse down
                    // before the browser can move the focus away from it.
                    onMouseDown={(event) => {
                        event.preventDefault();
                        props.onSelect(user);
                    }}
                    onMouseEnter={() => {
                        props.onHover(index);
                    }}
                    ref={index === props.activeIndex ? activeRef : undefined}
                    role="option"
                >
                    {/* Decorative: the name is already the option's accessible name. */}
                    <Avatar aria-hidden color="colorful" name={user.name} size={28} />
                    <span className={styles.optionText}>
                        <Text size={300} truncate wrap={false}>
                            {user.name}
                        </Text>
                        {user.jobTitle !== undefined && user.jobTitle.length > 0 ? (
                            <Text className={styles.secondary} size={200}>
                                {user.jobTitle}
                            </Text>
                        ) : null}
                    </span>
                </li>
            ))}
            {props.moreLabel !== undefined && props.moreLabel.length > 0 ? (
                // Not an option: it is a note about the result set, not something
                // to pick, so it carries no option role and is hidden from the
                // accessibility tree.
                <li aria-hidden="true">
                    <Text className={styles.more} size={200}>
                        {props.moreLabel}
                    </Text>
                </li>
            ) : null}
        </ul>
    );
};
