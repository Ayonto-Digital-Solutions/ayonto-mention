using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Configuration;
using Ayonto.Mention.Ingest.Identity;
using Ayonto.Mention.Ingest.Ledger;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Payload;
using Ayonto.Mention.Ingest.Recipients;
using Microsoft.Xrm.Sdk;

namespace Ayonto.Mention.Ingest
{
    /// <summary>
    /// Turns a saved record into event rows, and is the only place that decides
    /// whether one should exist.
    ///
    /// The order of the work is the argument for it. Each step either establishes
    /// something or ends the field, and nothing further along is reached on a claim
    /// that failed something earlier:
    ///
    /// 1. **has the companion metadata changed at all** — a filtering attribute fires
    ///    on presence in the request, not on change, so the handler establishes that
    ///    for itself by comparing the pre image with the post image;
    /// 2. **is this payload one this product wrote** — schema version, the source
    ///    column the host's own step mapped, well-formed identifiers, occurrence spans
    ///    that the committed text actually carries;
    /// 3. **what is the authoritative configuration for this column** — resolved from
    ///    published form metadata, failing closed where published forms disagree;
    /// 4. **is the claimed recipient a real, enabled user** — resolved against
    ///    `systemuser` by identifier;
    /// 5. **does this notification already exist** — same event identifier and same
    ///    immutable identity is a replay, same identifier and a different identity is a
    ///    conflict that overwrites nothing;
    /// 6. **only then**, the row.
    ///
    /// Nothing here sends anything. A dispatcher reads the rows this creates, and it is
    /// not implemented.
    ///
    /// Platform-free by construction: it is handed maps, not entities, and three
    /// interfaces rather than an `IOrganizationService`. The tracing service is the one
    /// platform type, because a diagnosis that does not reach the system job is a
    /// diagnosis nobody has.
    /// </summary>
    public sealed class MentionIngest
    {
        private readonly INotificationConfigurationResolver _configurations;
        private readonly IRecipientDirectory _recipients;
        private readonly IMentionEventLedger _ledger;
        private readonly ITracingService _trace;

        public MentionIngest(
            INotificationConfigurationResolver configurations,
            IRecipientDirectory recipients,
            IMentionEventLedger ledger,
            ITracingService trace)
        {
            if (configurations == null)
            {
                throw new ArgumentNullException(nameof(configurations));
            }
            if (recipients == null)
            {
                throw new ArgumentNullException(nameof(recipients));
            }
            if (ledger == null)
            {
                throw new ArgumentNullException(nameof(ledger));
            }
            if (trace == null)
            {
                throw new ArgumentNullException(nameof(trace));
            }

            _configurations = configurations;
            _recipients = recipients;
            _ledger = ledger;
            _trace = trace;
        }

        public IngestOutcome Run(IngestRequest request, StepConfiguration configuration)
        {
            if (request == null)
            {
                throw new ArgumentNullException(nameof(request));
            }
            if (configuration == null)
            {
                throw new ArgumentNullException(nameof(configuration));
            }

            var outcome = new IngestOutcome();
            foreach (FieldMapping mapping in configuration.Mappings)
            {
                RunField(request, mapping, outcome);
            }

            _trace.Trace("mention ingest: {0}", outcome);
            return outcome;
        }

        private void RunField(IngestRequest request, FieldMapping mapping, IngestOutcome outcome)
        {
            string committed = IngestRequest.Value(request.PostImage, mapping.MetadataField);

            if (request.IsUpdate)
            {
                string previous = IngestRequest.Value(request.PreImage, mapping.MetadataField);
                if (string.Equals(previous, committed, StringComparison.Ordinal))
                {
                    // "The step was invoked" does not mean "the metadata changed". Where
                    // an unchanged companion column was in the request anyway, the
                    // asynchronous job was queued before any of this code existed to
                    // object; the comparison is what keeps it from doing ledger work.
                    //
                    // The same-display-name case is on the other side of this
                    // comparison and stays there: two colleagues share a name, the
                    // writer picks the other one, the visible text does not change by a
                    // byte — and `recipientUserId` and `eventId` do. That is a real
                    // change, and it is processed.
                    outcome.FieldsUnchanged++;
                    _trace.Trace(
                        "mention ingest: {0}.{1} unchanged, nothing to do",
                        request.RecordTable,
                        mapping.SourceField);
                    return;
                }
            }

            if (committed == null)
            {
                // Nothing claimed. On a create that is the ordinary record; on an update
                // it is a record whose mentions were removed, and removing a mention
                // does not notify anybody about anything.
                return;
            }

            string text = IngestRequest.Value(request.PostImage, mapping.SourceField);
            CompanionPayloadResult read = CompanionPayloadParser.Read(
                committed,
                mapping.SourceField,
                text ?? string.Empty);

            if (read.Status == CompanionPayloadStatus.Absent)
            {
                return;
            }
            if (read.Status == CompanionPayloadStatus.Invalid)
            {
                outcome.FieldsRefused++;
                _trace.Trace(
                    "mention ingest: {0}.{1} refused — {2}",
                    request.RecordTable,
                    mapping.SourceField,
                    read.Problem);
                return;
            }

            IReadOnlyList<MentionClaim> claims = read.Payload.Mentions;
            if (claims.Count == 0)
            {
                // A payload whose claims no longer stand in the committed text. Nothing
                // was wrong with it; there is simply nobody the text names.
                return;
            }

            NotificationConfigurationResult resolved = _configurations.Resolve(
                request.RecordTable,
                mapping.SourceField);
            if (resolved.Status != NotificationConfigurationStatus.Resolved)
            {
                outcome.FieldsRefused++;
                _trace.Trace(
                    "mention ingest: {0}.{1} has no usable configuration ({2}) — {3}",
                    request.RecordTable,
                    mapping.SourceField,
                    resolved.Status,
                    resolved.Problem);
                return;
            }

            outcome.FieldsProcessed++;
            foreach (MentionClaim claim in claims)
            {
                RunClaim(request, mapping, claim, resolved.Configuration, outcome);
            }
        }

        private void RunClaim(
            IngestRequest request,
            FieldMapping mapping,
            MentionClaim claim,
            NotificationConfiguration configuration,
            IngestOutcome outcome)
        {
            Guid recipient;
            if (!Identifiers.TryParse(claim.RecipientUserId, out recipient))
            {
                // Unreachable from a parsed payload, and checked anyway: an identifier
                // that reached a Dataverse query without being parsed is the kind of
                // mistake that only shows up once.
                outcome.RecipientsRefused++;
                return;
            }

            RecipientResolution resolution = _recipients.Resolve(recipient);
            if (resolution.Status != RecipientStatus.Active)
            {
                outcome.RecipientsRefused++;
                _trace.Trace(
                    "mention ingest: recipient {0} refused ({1}), no event created",
                    claim.RecipientUserId,
                    resolution.Status);
                return;
            }

            var identity = new MentionEventIdentity(
                claim.EventId,
                request.RecordTable,
                request.RecordId,
                mapping.SourceField,
                claim.RecipientUserId);

            switch (Decide(_ledger.WithEventId(claim.EventId), identity))
            {
                case EventDecision.Replay:
                    // The same episode processed twice does not notify twice, which is the
                    // whole reason the event identifier exists.
                    outcome.Replayed++;
                    _trace.Trace("mention ingest: event {0} is a replay, nothing created", claim.EventId);
                    return;

                case EventDecision.Conflict:
                    // event_id_conflict. One identifier now names two different
                    // notifications, and there is no version of this that is safe to guess
                    // at: the existing row is not rewritten, and no second event is created.
                    outcome.Conflicted++;
                    _trace.Trace(
                        "mention ingest: event_id_conflict on {0} — it already names a different notification, refusing",
                        claim.EventId);
                    return;
            }

            LedgerWriteOutcome written = _ledger.Create(
                new MentionEventRow(identity, request.InitiatingUserId, configuration));
            if (written == LedgerWriteOutcome.Created)
            {
                outcome.Created++;
                _trace.Trace(
                    "mention ingest: created event {0} for {1}.{2}",
                    claim.EventId,
                    request.RecordTable,
                    mapping.SourceField);
                return;
            }

            // The identifier was free when it was looked up and taken by the time the row
            // was written: another asynchronous job for the same episode got there first.
            // The decision is the same one as before, taken again on what the ledger now
            // holds — the rule does not change because of who won a race.
            switch (Decide(_ledger.WithEventId(claim.EventId), identity))
            {
                case EventDecision.Replay:
                    outcome.Replayed++;
                    _trace.Trace(
                        "mention ingest: event {0} was written concurrently with the same identity — replay, one row stands",
                        claim.EventId);
                    return;

                case EventDecision.Conflict:
                    outcome.Conflicted++;
                    _trace.Trace(
                        "mention ingest: event_id_conflict on {0} — it was taken concurrently by a different notification, refusing",
                        claim.EventId);
                    return;

                default:
                    // The key refused the write and the ledger now shows nothing under
                    // that identifier. Nothing sound can be concluded from that, so
                    // nothing is written and the refusal is recorded as one.
                    outcome.Conflicted++;
                    _trace.Trace(
                        "mention ingest: event {0} was refused as taken but cannot be read back — refusing rather than retrying",
                        claim.EventId);
                    return;
            }
        }

        /// <summary>
        /// What an event identifier's existing rows mean for the event about to be
        /// written. One rule, and it is asked twice: before the write, and again if the
        /// uniqueness constraint says somebody else got there in between.
        /// </summary>
        private static EventDecision Decide(
            IReadOnlyList<MentionEventIdentity> existing,
            MentionEventIdentity identity)
        {
            if (existing == null || existing.Count == 0)
            {
                return EventDecision.New;
            }

            foreach (MentionEventIdentity other in existing)
            {
                if (identity.Matches(other))
                {
                    return EventDecision.Replay;
                }
            }

            return EventDecision.Conflict;
        }

        private enum EventDecision
        {
            New,
            Replay,
            Conflict,
        }
    }
}
