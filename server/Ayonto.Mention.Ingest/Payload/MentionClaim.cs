using System.Collections.Generic;

namespace Ayonto.Mention.Ingest.Payload
{
    /// <summary>
    /// One person the saved editing session claims to have mentioned, once.
    ///
    /// A claim, named as one. Every value here came out of a column on a business
    /// record that anybody who may write the text may write, so nothing in it is
    /// believed on its own: the recipient is resolved against `systemuser` before
    /// anything is written about them, and the event identifier identifies without
    /// authorizing anything at all.
    /// </summary>
    public sealed class MentionClaim
    {
        public MentionClaim(string eventId, string recipientUserId, IReadOnlyList<MentionOccurrence> occurrences)
        {
            EventId = eventId;
            RecipientUserId = recipientUserId;
            Occurrences = occurrences;
        }

        /// <summary>The episode identifier, normalized. Identifies; does not authorize.</summary>
        public string EventId { get; }

        /// <summary>The claimed recipient, normalized. Never a display name, never an address.</summary>
        public string RecipientUserId { get; }

        /// <summary>
        /// Every place this person is named in the committed text, in text order,
        /// after the structurally impossible ones have been dropped.
        /// </summary>
        public IReadOnlyList<MentionOccurrence> Occurrences { get; }
    }
}
