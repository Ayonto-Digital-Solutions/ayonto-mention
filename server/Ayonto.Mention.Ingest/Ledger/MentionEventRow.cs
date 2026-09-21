using Ayonto.Mention.Ingest.Notifications;

namespace Ayonto.Mention.Ingest.Ledger
{
    /// <summary>
    /// One event, ready to be written: its immutable identity, who caused it, and the
    /// notification configuration that was authoritative at that moment.
    /// </summary>
    public sealed class MentionEventRow
    {
        public MentionEventRow(
            MentionEventIdentity identity,
            string initiatingUserId,
            NotificationConfiguration configuration)
        {
            Identity = identity;
            InitiatingUserId = initiatingUserId;
            Configuration = configuration;
        }

        public MentionEventIdentity Identity { get; }

        /// <summary>
        /// The user whose save created this event, from the execution context.
        ///
        /// Writing the row as SYSTEM does not make the event anonymous: it separates
        /// *who did it*, which comes from the platform, from *who may persist it*,
        /// which is a permission question.
        /// </summary>
        public string InitiatingUserId { get; }

        /// <summary>The snapshot. Frozen here, read by the dispatcher, never re-resolved.</summary>
        public NotificationConfiguration Configuration { get; }
    }

    /// <summary>
    /// The event ledger, as the ingest needs it: what already exists under an event
    /// identifier, and one way to add a row.
    ///
    /// An interface so that the idempotency rules and the write can be exercised
    /// without a Dataverse to write to — and so that a test can assert what table was
    /// asked for.
    /// </summary>
    public interface IMentionEventLedger
    {
        /// <summary>
        /// The identities of every event already recorded under this event identifier.
        /// Empty where there are none. Never null.
        /// </summary>
        System.Collections.Generic.IReadOnlyList<MentionEventIdentity> WithEventId(string eventId);

        /// <summary>Creates the event row. The caller has already decided that it should exist.</summary>
        void Create(MentionEventRow row);
    }
}
