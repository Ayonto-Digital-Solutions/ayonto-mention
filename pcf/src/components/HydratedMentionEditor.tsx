import * as React from "react";

import { MentionEditor } from "./MentionEditor";
import type { MentionEditorProps } from "./MentionEditor";
import { usePersistedMentions } from "../hooks/usePersistedMentions";
import type { MentionRepository } from "../domain/mentionPersistence";
import type { MentionRecordContext } from "../domain/recordContext";

export interface HydratedMentionEditorProps
    extends Omit<MentionEditorProps, "persistedRecipients"> {
    /** Held behind the contract: the editor layer never sees Dataverse. */
    readonly repository: MentionRepository;
    /** The record whose stored mentions apply, or null while there is none. */
    readonly recordContext: MentionRecordContext | null;
}

/**
 * A mention editor that also knows who its text was mentioning before.
 *
 * The split is deliberate. `MentionEditor` stays a component that is handed
 * everything it needs and reads nothing by itself; the asynchronous load lives
 * here, in React, where an answer that arrives after the fact is a state update
 * and not a pretended change of the field's value. The component framework
 * adapter keeps what is genuinely its own — the repository instance, the grace
 * period, and the record boundary that remounts this component.
 */
export const HydratedMentionEditor: React.FC<HydratedMentionEditorProps> = (props) => {
    const { recordContext, repository, ...editor } = props;
    const persistedRecipients = usePersistedMentions(repository, recordContext);

    return <MentionEditor {...editor} persistedRecipients={persistedRecipients} />;
};
