import * as React from "react";

import type { MentionRecipient, MentionRepository } from "../domain/mentionPersistence";
import type { MentionRecordContext } from "../domain/recordContext";

/** One shared empty result, so "nothing loaded" never looks like a change. */
const NONE: readonly MentionRecipient[] = [];

/** What one read belongs to. Identifies the scope; never parsed apart again. */
function scopeKeyOf(context: MentionRecordContext): string {
    // The separator cannot occur in a normalized logical name or record id, so two
    // different scopes can never produce the same key.
    return [context.recordTable, context.recordId, context.sourceField].join("|");
}

interface LoadedScope {
    readonly key: string;
    readonly recipients: readonly MentionRecipient[];
}

/**
 * Loads the people this record's field was mentioned to before.
 *
 * The read belongs to React, not to the component framework's render cycle: a
 * finished `list()` is not a new field value, and telling the platform that the
 * output changed in order to get a re-render would be a lie about what happened.
 * React state is what the answer arrives in.
 *
 * Exactly one read per scope — record, table and column together. The identity
 * of the context object is deliberately not what that is measured by: the
 * adapter builds a fresh one on every `updateView`, so a reference check would
 * start a new read on every host update.
 *
 * A read that is still out when the form moves to another record is disowned by
 * the effect's cleanup, which runs both on a scope change and on unmount. So a
 * late answer from the record just left cannot hydrate the one now open, and
 * cannot update a component that is gone either. The result is also kept under
 * the key it was read for, so what is handed out is only ever the answer for the
 * scope being asked about. Both together, on purpose: the editor is remounted at
 * a record boundary as well, and none of the three is meant to be the only thing
 * standing between two records.
 *
 * A failed read leaves this scope without stored identities and is otherwise
 * consumed: it is already a neutral `MentionRepositoryError`, it must not be
 * logged — a Dataverse failure can carry the environment URL and schema names —
 * and the field stays perfectly usable without it. Telling the user that earlier
 * mentions could not be loaded is a later step.
 */
export function usePersistedMentions(
    repository: MentionRepository,
    context: MentionRecordContext | null
): readonly MentionRecipient[] {
    const scopeKey = context === null ? null : scopeKeyOf(context);
    // Read inside the effect rather than listed as a dependency, so the scope key
    // alone decides when a read starts.
    const contextRef = React.useRef(context);
    contextRef.current = context;

    const [loaded, setLoaded] = React.useState<LoadedScope | null>(null);

    React.useEffect(() => {
        const scope = contextRef.current;
        if (scope === null) {
            // Nothing to read against: a record without an id has no stored
            // mentions, and asking for them would be a query for every new form.
            return undefined;
        }

        // A copy, so the read is answered for the record it was started for even
        // if the form has moved on by the time it comes back.
        const captured: MentionRecordContext = {
            recordId: scope.recordId,
            recordTable: scope.recordTable,
            sourceField: scope.sourceField,
        };
        const key = scopeKeyOf(captured);
        let active = true;

        const remember = (recipients: readonly MentionRecipient[]): void => {
            setLoaded((current) => {
                // A read that found nobody, on a field that had loaded nobody
                // yet, leaves this component exactly as it stands: there are no
                // identities either way. Recording it would re-render every
                // mention field on every form for nothing.
                if (current === null && recipients.length === 0) {
                    return current;
                }
                return { key, recipients };
            });
        };

        void repository.list(captured).then(
            (mentions) => {
                if (active) {
                    remember(mentions.map((mention) => mention.recipient));
                }
                // Nothing is passed on: the chain ends here, and the explicit
                // value is what `promise/always-return` asks a then() callback for.
                return undefined;
            },
            () => {
                // Nothing could be loaded for this scope. The failure is already
                // neutral, it is deliberately not logged, and the field goes on
                // working without it.
                if (active) {
                    remember(NONE);
                }
            }
        );

        return () => {
            active = false;
        };
    }, [repository, scopeKey]);

    return loaded !== null && loaded.key === scopeKey ? loaded.recipients : NONE;
}
