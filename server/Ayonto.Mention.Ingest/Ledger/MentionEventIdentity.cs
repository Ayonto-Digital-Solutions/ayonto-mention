using System;

namespace Ayonto.Mention.Ingest.Ledger
{
    /// <summary>
    /// What makes a notification the notification it is, and never changes:
    ///
    /// <code>eventId + recordTable + recordId + sourceField + recipientUserId</code>
    ///
    /// Occurrence positions are not part of it and never become part of it. Neither is
    /// `ayonto_Name`, which is a label for people reading a grid.
    ///
    /// Every value is already normalized when an identity is built — logical names
    /// lower case, identifiers canonical — because these are compared as strings. Two
    /// spellings of one GUID would otherwise be two recipients, and a replay would
    /// never match the event it is replaying.
    /// </summary>
    public sealed class MentionEventIdentity
    {
        public MentionEventIdentity(
            string eventId,
            string recordTable,
            string recordId,
            string sourceField,
            string recipientUserId)
        {
            EventId = eventId;
            RecordTable = recordTable;
            RecordId = recordId;
            SourceField = sourceField;
            RecipientUserId = recipientUserId;
        }

        public string EventId { get; }

        public string RecordTable { get; }

        public string RecordId { get; }

        public string SourceField { get; }

        public string RecipientUserId { get; }

        /// <summary>
        /// True where this is the same notification, compared on all five values.
        /// Ordinal, not culture-aware: these are identifiers, not words.
        /// </summary>
        public bool Matches(MentionEventIdentity other)
        {
            return other != null
                && string.Equals(EventId, other.EventId, StringComparison.Ordinal)
                && string.Equals(RecordTable, other.RecordTable, StringComparison.Ordinal)
                && string.Equals(RecordId, other.RecordId, StringComparison.Ordinal)
                && string.Equals(SourceField, other.SourceField, StringComparison.Ordinal)
                && string.Equals(RecipientUserId, other.RecipientUserId, StringComparison.Ordinal);
        }
    }
}
