/**
 * Turning mentions that were persisted earlier back into the identities the
 * editor tracks.
 *
 * The text alone cannot say who "@Robin Fox" means — that is the whole reason
 * the identity is stored alongside it. Reading it back is therefore an inference,
 * and this module states exactly how far that inference may go: far enough to
 * restore a mention written on an earlier visit, never far enough to guess.
 *
 * Pure and platform-neutral: no React, no Dataverse, no component framework.
 */

import { findKnownMentions } from "./mentionText";
import type { MentionOccurrence } from "./mentionLifecycle";
import type { MentionRecipient } from "./mentionPersistence";
import { normalizeDataverseId } from "./recordContext";

/** The one person a display name may safely be taken to mean. */
export interface PersistedIdentity {
    readonly userId: string;
    /** Only carried when every stored row agrees on it. */
    readonly email?: string | undefined;
}

/** What is known about one display name while the stored rows are read. */
interface GatheredIdentity {
    userId: string;
    /** Two different people were stored under this name, so it means neither. */
    ambiguous: boolean;
    email: string | undefined;
    /** The rows disagree on the address, so none of them is the address. */
    emailConflict: boolean;
}

/**
 * Works out which display names can be resolved to a person, and which cannot.
 *
 * A display name is not an identity. Two people called "Robin Fox" leave two
 * stored rows that differ only in the id, and the text they both produced is the
 * same — so the name is dropped rather than resolved to whichever row came back
 * first. Several rows for the *same* person are not ambiguous at all: one person
 * mentioned three times is three rows, and ids are compared in their normalized
 * form so a braced or upper-case id is not mistaken for somebody else.
 *
 * The address is treated separately and more strictly still: it is only carried
 * when every row that has one agrees. Rows without an address say nothing either
 * way. A disagreement costs the address, never the identity — the id is who the
 * mention means, and the id is not in doubt.
 */
export function resolvePersistedIdentities(
    recipients: readonly MentionRecipient[]
): ReadonlyMap<string, PersistedIdentity> {
    const gathered = new Map<string, GatheredIdentity>();

    for (const recipient of recipients) {
        const name = recipient.name.trim();
        const userId = normalizeDataverseId(recipient.userId);
        // A row that names nobody, or nobody identifiable, speaks for no mention.
        if (name.length === 0 || userId.length === 0) {
            continue;
        }

        const email = (recipient.email ?? "").trim();
        const known = gathered.get(name);
        if (known === undefined) {
            gathered.set(name, {
                userId,
                ambiguous: false,
                email: email.length > 0 ? email : undefined,
                emailConflict: false,
            });
            continue;
        }

        if (known.userId !== userId) {
            known.ambiguous = true;
        }
        if (email.length > 0) {
            if (known.email === undefined) {
                known.email = email;
            } else if (known.email !== email) {
                known.emailConflict = true;
            }
        }
    }

    const identities = new Map<string, PersistedIdentity>();
    for (const [name, known] of gathered) {
        if (known.ambiguous) {
            continue;
        }
        identities.set(
            name,
            known.email === undefined || known.emailConflict
                ? { userId: known.userId }
                : { userId: known.userId, email: known.email }
        );
    }

    return identities;
}

/** Keeps a merged set in text order, the way the editor reports it. */
function byStart(left: MentionOccurrence, right: MentionOccurrence): number {
    return left.start - right.start;
}

/**
 * Merges the identities loaded from the store into the mentions the editor is
 * already tracking, for exactly the text given.
 *
 * What the editor tracks always wins. An occurrence the user picked in this
 * session knows which of two namesakes was meant and which address that
 * suggestion carried; a stored row only knows what an earlier session wrote. So
 * a stored identity may fill a gap and may never overwrite one — including where
 * the two spans merely overlap, which is how "@Dana" picked by hand survives a
 * stored "Dana Winter" standing in the same place.
 *
 * Positions are part of what an occurrence is, so one person named twice
 * hydrates twice, at both places, and the two stay distinct.
 */
export function hydrateOccurrences(
    text: string,
    identities: ReadonlyMap<string, PersistedIdentity>,
    tracked: readonly MentionOccurrence[]
): MentionOccurrence[] {
    const candidates = [...identities].map(([name, identity]) => ({ name, identity }));
    const merged: MentionOccurrence[] = [...tracked];

    for (const match of findKnownMentions(text, candidates)) {
        const { identity, name } = match.candidate;
        const end = match.start + name.length + 1;
        const overlapsTracked = tracked.some(
            (occurrence) =>
                occurrence.start < end &&
                match.start < occurrence.start + occurrence.name.length + 1
        );
        if (overlapsTracked) {
            continue;
        }

        merged.push(
            identity.email === undefined
                ? { start: match.start, name, userId: identity.userId }
                : { start: match.start, name, userId: identity.userId, email: identity.email }
        );
    }

    return merged.sort(byStart);
}
