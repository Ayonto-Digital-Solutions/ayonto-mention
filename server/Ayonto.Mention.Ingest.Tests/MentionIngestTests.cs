using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Configuration;
using Ayonto.Mention.Ingest.Ledger;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Tests.Fakes;
using Ayonto.Mention.Ingest.Tests.Support;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The ingest as a whole: a saved record in, event rows out, and every rule about
    /// when a row should not exist.
    /// </summary>
    public sealed class MentionIngestTests
    {
        private const string Table = "ayonto_hosttable";
        private const string Field = "description";
        private const string MetadataField = "ayonto_descriptionmentions";
        private const string Text = "ask @Alex Rivera and @Dana Winter";

        private static readonly int AlexAt = Text.IndexOf("@Alex", StringComparison.Ordinal);
        private static readonly int DanaAt = Text.IndexOf("@Dana", StringComparison.Ordinal);

        private readonly FakeTracingService _trace = new FakeTracingService();
        private readonly FakeRecipientDirectory _recipients = new FakeRecipientDirectory();
        private readonly FakeMentionEventLedger _ledger = new FakeMentionEventLedger();
        private FakeConfigurationResolver _configurations =
            new FakeConfigurationResolver(NotificationConfigurationResult.Resolved(NotificationConfiguration.Silent));

        private static StepConfiguration Mapping(string configuration = Field + "=" + MetadataField)
        {
            StepConfiguration parsed;
            string problem;
            Assert.True(StepConfiguration.TryParse(configuration, out parsed, out problem), problem);
            return parsed;
        }

        private static IngestRequest Update(
            IReadOnlyDictionary<string, string> post,
            IReadOnlyDictionary<string, string> pre,
            string recordId = null)
        {
            return new IngestRequest(
                "Update",
                Table,
                recordId ?? Payloads.NewId(),
                Payloads.NewId(),
                post,
                pre);
        }

        private static IngestRequest Create(IReadOnlyDictionary<string, string> post)
        {
            return new IngestRequest("Create", Table, Payloads.NewId(), Payloads.NewId(), post, null);
        }

        private IngestOutcome Run(IngestRequest request, StepConfiguration configuration = null)
        {
            var ingest = new MentionIngest(_configurations, _recipients, _ledger, _trace);
            return ingest.Run(request, configuration ?? Mapping());
        }

        private Guid Recipient()
        {
            Guid user = Guid.NewGuid();
            _recipients.WithActive(user);
            return user;
        }

        private static string Canonical(Guid user)
        {
            return user.ToString("D").ToLowerInvariant();
        }

        [Fact]
        public void creates_one_event_for_a_mention_on_a_created_record()
        {
            Guid user = Recipient();
            string eventId = Payloads.NewId();
            var configuration = new NotificationConfiguration(
                new ChannelConfiguration(true, "Subject", "Body", null),
                ChannelConfiguration.Off,
                ChannelConfiguration.Off);
            _configurations = new FakeConfigurationResolver(NotificationConfigurationResult.Resolved(configuration));

            IngestRequest request = Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(eventId, Canonical(user), AlexAt, 12))));

            IngestOutcome outcome = Run(request);

            Assert.Equal(1, outcome.Created);
            Assert.Equal(1, outcome.FieldsProcessed);
            MentionEventRow row = Assert.Single(_ledger.Rows);
            Assert.Equal(eventId, row.Identity.EventId);
            Assert.Equal(Table, row.Identity.RecordTable);
            Assert.Equal(request.RecordId, row.Identity.RecordId);
            Assert.Equal(Field, row.Identity.SourceField);
            Assert.Equal(Canonical(user), row.Identity.RecipientUserId);
            Assert.Equal(request.InitiatingUserId, row.InitiatingUserId);
            Assert.Same(configuration, row.Configuration);
        }

        [Fact]
        public void an_update_whose_metadata_did_not_change_does_no_ledger_work()
        {
            // A filtering attribute fires on presence in the request, not on change. The
            // job is already queued by the time this code runs; the comparison is what
            // keeps it from writing anything.
            Guid user = Recipient();
            string payload = Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(user), AlexAt, 12));

            IngestOutcome outcome = Run(Update(
                Payloads.Image(Field, Text, MetadataField, payload),
                Payloads.Image(MetadataField, payload)));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.FieldsUnchanged);
            Assert.Empty(_ledger.Rows);
            Assert.Empty(_ledger.LookedUp);
            Assert.Empty(_configurations.Resolved);
            Assert.True(_trace.Said("unchanged"));
        }

        [Fact]
        public void an_update_that_swaps_one_namesake_for_another_is_processed()
        {
            // The visible text does not change by a byte; the recipient and the episode
            // do. That is a real metadata change and the whole reason the comparison is
            // on the metadata rather than on the text.
            Guid other = Recipient();
            string before = Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexAt, 12));
            string after = Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(other), AlexAt, 12));

            IngestOutcome outcome = Run(Update(
                Payloads.Image(Field, Text, MetadataField, after),
                Payloads.Image(MetadataField, before)));

            Assert.Equal(1, outcome.Created);
            Assert.Equal(Canonical(other), Assert.Single(_ledger.Rows).Identity.RecipientUserId);
        }

        [Fact]
        public void an_update_that_removed_every_mention_notifies_nobody()
        {
            IngestOutcome outcome = Run(Update(
                Payloads.Image(Field, "ask nobody"),
                Payloads.Image(MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Empty(_ledger.Rows);
        }

        [Fact]
        public void one_person_mentioned_several_times_in_one_episode_is_one_row()
        {
            const string text = "@Alex Rivera and @Alex Rivera again";
            Guid user = Recipient();

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, text,
                MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Canonical(user), 0, 12, text.LastIndexOf('@'), 12)))));

            Assert.Equal(1, outcome.Created);
            Assert.Single(_ledger.Rows);
        }

        [Fact]
        public void two_people_in_one_episode_are_two_rows()
        {
            Guid alex = Recipient();
            Guid dana = Recipient();

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Canonical(alex), AlexAt, 12),
                    Payloads.Mention(Payloads.NewId(), Canonical(dana), DanaAt, 12)))));

            Assert.Equal(2, outcome.Created);
            Assert.Equal(2, _ledger.Rows.Count);
        }

        [Fact]
        public void the_same_episode_processed_twice_does_not_notify_twice()
        {
            Guid user = Recipient();
            string eventId = Payloads.NewId();
            string recordId = Payloads.NewId();
            string payload = Payloads.Metadata(Field, Payloads.Mention(eventId, Canonical(user), AlexAt, 12));
            _ledger.Holding(new MentionEventIdentity(eventId, Table, recordId, Field, Canonical(user)));

            IngestOutcome outcome = Run(Update(
                Payloads.Image(Field, Text, MetadataField, payload),
                Payloads.Image(MetadataField, "{}"),
                recordId));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.Replayed);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("replay"));
        }

        [Fact]
        public void an_event_identifier_that_already_names_a_different_notification_is_refused()
        {
            Guid user = Recipient();
            string eventId = Payloads.NewId();
            _ledger.Holding(new MentionEventIdentity(eventId, Table, Payloads.NewId(), Field, Payloads.NewId()));

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(eventId, Canonical(user), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.Conflicted);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("event_id_conflict"));
        }

        [Fact]
        public void a_concurrent_write_of_the_same_event_converges_on_one_row()
        {
            // Both jobs looked, both found nothing, one of them wrote. The alternate key
            // refuses the second write, and the second job then reads the same identity
            // back: that is a replay, not a failure and not a second notification.
            Guid user = Recipient();
            string eventId = Payloads.NewId();
            string recordId = Payloads.NewId();
            _ledger.LosingTheRaceTo(
                new MentionEventIdentity(eventId, Table, recordId, Field, Canonical(user)));

            IngestOutcome outcome = Run(Update(
                Payloads.Image(Field, Text, MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(eventId, Canonical(user), AlexAt, 12))),
                Payloads.Image(MetadataField, "{}"),
                recordId));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.Replayed);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("written concurrently"));
        }

        [Fact]
        public void a_concurrent_write_of_a_different_notification_under_one_identifier_is_a_conflict()
        {
            Guid user = Recipient();
            string eventId = Payloads.NewId();
            _ledger.LosingTheRaceTo(
                new MentionEventIdentity(eventId, Table, Payloads.NewId(), Field, Payloads.NewId()));

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(eventId, Canonical(user), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.Conflicted);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("event_id_conflict"));
        }

        [Fact]
        public void an_identifier_refused_as_taken_but_unreadable_afterwards_creates_nothing()
        {
            // Nothing sound follows from "the key says taken" and "the ledger says
            // nothing", so nothing is written.
            Guid user = Recipient();
            _ledger.LosingTheRaceTo(null);

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Canonical(user), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.Conflicted);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("cannot be read back"));
        }

        [Fact]
        public void a_recipient_who_does_not_exist_gets_no_event()
        {
            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.RecipientsRefused);
            Assert.Empty(_ledger.Rows);
            Assert.Empty(_ledger.LookedUp);
        }

        [Fact]
        public void a_disabled_recipient_gets_no_event()
        {
            Guid user = Guid.NewGuid();
            _recipients.WithDisabled(user);

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(user), AlexAt, 12)))));

            Assert.Equal(1, outcome.RecipientsRefused);
            Assert.Empty(_ledger.Rows);
            Assert.True(_trace.Said("Disabled"));
        }

        [Fact]
        public void a_field_with_no_published_configuration_creates_nothing()
        {
            Guid user = Recipient();
            _configurations = new FakeConfigurationResolver(
                NotificationConfigurationResult.NotConfigured("no published instance"));

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(user), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.FieldsRefused);
            Assert.Empty(_ledger.Rows);
            Assert.Empty(_recipients.LookedUp);
        }

        [Fact]
        public void published_configurations_that_disagree_create_nothing()
        {
            Guid user = Recipient();
            _configurations = new FakeConfigurationResolver(
                NotificationConfigurationResult.Conflicting("two forms disagree"));

            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(user), AlexAt, 12)))));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.FieldsRefused);
            Assert.True(_trace.Said("Conflicting"));
        }

        [Fact]
        public void a_payload_this_product_did_not_write_creates_nothing()
        {
            IngestOutcome outcome = Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, "{\"schemaVersion\":99}")));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(1, outcome.FieldsRefused);
            Assert.Empty(_configurations.Resolved);
        }

        [Fact]
        public void a_record_with_no_companion_value_is_an_ordinary_record()
        {
            IngestOutcome outcome = Run(Create(Payloads.Image(Field, "no mentions here")));

            Assert.Equal(0, outcome.Created);
            Assert.Equal(0, outcome.FieldsRefused);
            Assert.Empty(_configurations.Resolved);
        }

        [Fact]
        public void a_table_may_carry_more_than_one_mention_field()
        {
            Guid alex = Recipient();
            Guid dana = Recipient();
            const string notes = "ayonto_notes";
            const string notesMetadata = "ayonto_notesmentions";

            IngestOutcome outcome = Run(
                Create(Payloads.Image(
                    Field, Text,
                    MetadataField, Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Canonical(alex), AlexAt, 12)),
                    notes, "@Dana Winter please",
                    notesMetadata, Payloads.Metadata(notes, Payloads.Mention(Payloads.NewId(), Canonical(dana), 0, 12)))),
                Mapping(Field + "=" + MetadataField + "\n" + notes + "=" + notesMetadata));

            Assert.Equal(2, outcome.Created);
            Assert.Equal(2, outcome.FieldsProcessed);
            Assert.Equal(new[] { Field, notes }, new[] { _ledger.Rows[0].Identity.SourceField, _ledger.Rows[1].Identity.SourceField });
            Assert.Equal(
                new[] { Table + "." + Field, Table + "." + notes },
                _configurations.Resolved.ToArray());
        }

        [Fact]
        public void one_field_failing_closed_does_not_stop_the_other()
        {
            Guid dana = Recipient();
            const string notes = "ayonto_notes";
            const string notesMetadata = "ayonto_notesmentions";

            IngestOutcome outcome = Run(
                Create(Payloads.Image(
                    Field, Text,
                    MetadataField, "not a payload",
                    notes, "@Dana Winter please",
                    notesMetadata, Payloads.Metadata(notes, Payloads.Mention(Payloads.NewId(), Canonical(dana), 0, 12)))),
                Mapping(Field + "=" + MetadataField + "\n" + notes + "=" + notesMetadata));

            Assert.Equal(1, outcome.Created);
            Assert.Equal(1, outcome.FieldsRefused);
        }

        [Fact]
        public void the_configuration_is_resolved_once_per_field_rather_than_once_per_recipient()
        {
            Guid alex = Recipient();
            Guid dana = Recipient();

            Run(Create(Payloads.Image(
                Field, Text,
                MetadataField, Payloads.Metadata(
                    Field,
                    Payloads.Mention(Payloads.NewId(), Canonical(alex), AlexAt, 12),
                    Payloads.Mention(Payloads.NewId(), Canonical(dana), DanaAt, 12)))));

            Assert.Single(_configurations.Resolved);
        }

        [Fact]
        public void nothing_is_run_without_a_request_and_a_mapping()
        {
            var ingest = new MentionIngest(_configurations, _recipients, _ledger, _trace);

            Assert.Throws<ArgumentNullException>(() => ingest.Run(null, Mapping()));
            Assert.Throws<ArgumentNullException>(() => ingest.Run(Create(Payloads.Image()), null));
        }

        [Fact]
        public void the_ingest_needs_every_collaborator_it_was_given()
        {
            Assert.Throws<ArgumentNullException>(() => new MentionIngest(null, _recipients, _ledger, _trace));
            Assert.Throws<ArgumentNullException>(() => new MentionIngest(_configurations, null, _ledger, _trace));
            Assert.Throws<ArgumentNullException>(() => new MentionIngest(_configurations, _recipients, null, _trace));
            Assert.Throws<ArgumentNullException>(() => new MentionIngest(_configurations, _recipients, _ledger, null));
        }
    }
}
