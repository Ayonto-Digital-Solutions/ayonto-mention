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

    /// <summary>What happened when the ledger was asked to add a row.</summary>
    public enum LedgerWriteOutcome
    {
        /// <summary>The row was written.</summary>
        Created,

        /// <summary>
        /// The platform refused the write because the event identifier is already
        /// taken.
        ///
        /// This is what the alternate key on `ayonto_EventId` is for. Looking for an
        /// existing event and then creating one are two operations, and two
        /// asynchronous jobs for the same episode can both look, both find nothing,
        /// and both write. No amount of querying closes that window; a uniqueness
        /// constraint does, and this is the constraint speaking.
        /// </summary>
        EventIdTaken,
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

        /// <summary>
        /// Writes the event row, and says whether the event identifier turned out to be
        /// taken. The caller has already decided that the row should exist; the platform
        /// gets the last word on whether it still may.
        /// </summary>
        LedgerWriteOutcome Create(MentionEventRow row);
    }
}
