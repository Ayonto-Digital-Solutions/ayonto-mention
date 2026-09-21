using System;
using System.Collections.Generic;
using System.ServiceModel;
using Ayonto.Mention.Ingest.Ledger;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Tests.Fakes;
using Ayonto.Mention.Ingest.Tests.Support;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The write itself: which table, which columns, and which values.
    ///
    /// The table is the point. `ayonto_mentionevent` is the ledger and `ayonto_mention`
    /// is not — the second one came from the legacy product, it is user-owned, its
    /// columns carry a recipient's name and address, and the browser used to write it
    /// directly. Writing there would put notification state back in the trust model this
    /// ingest exists to replace.
    /// </summary>
    public sealed class MentionEventLedgerTests
    {
        private const string Table = "ayonto_hosttable";
        private const string Field = "description";

        private static MentionEventIdentity Identity(string eventId, string recipient)
        {
            return new MentionEventIdentity(eventId, Table, Payloads.NewId(), Field, recipient);
        }

        private static MentionEventRow Row(NotificationConfiguration configuration)
        {
            return new MentionEventRow(
                Identity(Payloads.NewId(), Payloads.NewId()),
                Payloads.NewId(),
                configuration);
        }

        [Fact]
        public void the_ledger_is_the_event_table_and_nothing_else()
        {
            Assert.Equal("ayonto_mentionevent", MentionEventColumns.TableLogicalName);
        }

        /// <summary>
        /// `DuplicateRecordEntityKey`: "Entity Key {0} violated. A record with the same
        /// value for {1} already exists." The alternate key on `ayonto_EventId` refusing a
        /// second row under an identifier that is taken.
        /// </summary>
        private const int DuplicateRecordEntityKey = unchecked((int)0x80060892);

        /// <summary>
        /// `CrmSQLUniqueIndexOrConstraintViolation` — "The operation attempted to insert a
        /// duplicate value for an attribute with a unique constraint." Broader than this
        /// key, and therefore **not** idempotency.
        /// </summary>
        private const int UniqueConstraintViolation = unchecked((int)0x80073002);

        /// <summary>`PrivilegeDenied`. Nothing to do with idempotency, and must not be swallowed.</summary>
        private const int PrivilegeDenied = unchecked((int)0x80040220);

        [Fact]
        public void a_write_that_goes_through_reports_that_it_did()
        {
            var service = new FakeOrganizationService();

            Assert.Equal(
                LedgerWriteOutcome.Created,
                new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent)));
        }

        [Fact]
        public void the_event_identifier_being_taken_is_an_outcome_rather_than_a_failure()
        {
            // Two asynchronous jobs for one episode can both find nothing and both write.
            // The alternate key is what stops the second one, and this is the ingest
            // hearing it rather than failing the job over it.
            var service = new FakeOrganizationService().RefusingCreate(DuplicateRecordEntityKey);

            Assert.Equal(
                LedgerWriteOutcome.EventIdTaken,
                new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent)));
            Assert.Empty(service.Created);
        }

        [Fact]
        public void a_generic_unique_constraint_violation_is_not_treated_as_idempotency()
        {
            // 0x80073002 says only that *some* unique index or constraint was violated.
            // Reading it as "the event identifier is taken" would let a genuine storage
            // problem end a system job successfully, having recorded nothing. Whether a
            // real race on this key can surface that way instead is a question only a real
            // environment can answer.
            var service = new FakeOrganizationService().RefusingCreate(UniqueConstraintViolation);

            FaultException<OrganizationServiceFault> thrown =
                Assert.Throws<FaultException<OrganizationServiceFault>>(
                    () => new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent)));

            Assert.Equal(UniqueConstraintViolation, thrown.Detail.ErrorCode);
        }

        [Fact]
        public void the_same_answer_is_read_out_of_an_inner_fault()
        {
            var service = new FakeOrganizationService().RefusingCreateWithInnerFault(DuplicateRecordEntityKey);

            Assert.Equal(
                LedgerWriteOutcome.EventIdTaken,
                new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent)));
        }

        [Fact]
        public void any_other_fault_belongs_to_the_system_job_and_is_not_swallowed()
        {
            // An ingest that read every fault as idempotency would report success for a
            // notification it never recorded.
            var service = new FakeOrganizationService().RefusingCreate(PrivilegeDenied);

            FaultException<OrganizationServiceFault> thrown =
                Assert.Throws<FaultException<OrganizationServiceFault>>(
                    () => new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent)));

            Assert.Equal(PrivilegeDenied, thrown.Detail.ErrorCode);
        }

        [Fact]
        public void creates_the_row_on_the_event_table()
        {
            var service = new FakeOrganizationService();
            MentionEventRow row = Row(NotificationConfiguration.Silent);

            new MentionEventLedger(service).Create(row);

            Entity created = Assert.Single(service.Created);
            Assert.Equal("ayonto_mentionevent", created.LogicalName);
            Assert.Equal(row.Identity.EventId, created["ayonto_eventid"]);
            Assert.Equal(row.Identity.RecordTable, created["ayonto_recordtable"]);
            Assert.Equal(row.Identity.RecordId, created["ayonto_recordid"]);
            Assert.Equal(row.Identity.SourceField, created["ayonto_sourcefield"]);
            Assert.Equal(row.Identity.RecipientUserId, created["ayonto_recipientuserid"]);
            Assert.Equal(row.InitiatingUserId, created["ayonto_initiatinguserid"]);
            Assert.Equal(NotificationConfiguration.SchemaVersion, created["ayonto_configschemaversion"]);
        }

        [Fact]
        public void writes_the_whole_configuration_snapshot()
        {
            var service = new FakeOrganizationService();
            var configuration = new NotificationConfiguration(
                new ChannelConfiguration(true, "Subject", "Mail body", "Open the record"),
                new ChannelConfiguration(true, "Teams title", "Teams body", "Open"),
                new ChannelConfiguration(false, null, null, null));

            new MentionEventLedger(service).Create(Row(configuration));

            Entity created = Assert.Single(service.Created);
            Assert.Equal(true, created["ayonto_emailenabled"]);
            Assert.Equal("Subject", created["ayonto_emailsubject"]);
            Assert.Equal("Mail body", created["ayonto_emailbody"]);
            Assert.Equal("Open the record", created["ayonto_emaillinktext"]);

            Assert.Equal(true, created["ayonto_teamsenabled"]);
            Assert.Equal("Teams title", created["ayonto_teamstitle"]);
            Assert.Equal("Teams body", created["ayonto_teamsbody"]);
            Assert.Equal("Open", created["ayonto_teamslinktext"]);

            Assert.Equal(false, created["ayonto_inappenabled"]);
            Assert.Null(created["ayonto_inapptitle"]);
            Assert.Null(created["ayonto_inappbody"]);
            Assert.Null(created["ayonto_inapplinktext"]);
        }

        [Fact]
        public void writes_nothing_but_the_columns_the_event_table_has()
        {
            var service = new FakeOrganizationService();
            new MentionEventLedger(service).Create(Row(NotificationConfiguration.Silent));

            var expected = new HashSet<string>(StringComparer.Ordinal)
            {
                "ayonto_name",
                "ayonto_eventid",
                "ayonto_recordtable",
                "ayonto_recordid",
                "ayonto_sourcefield",
                "ayonto_recipientuserid",
                "ayonto_initiatinguserid",
                "ayonto_configschemaversion",
                "ayonto_emailenabled",
                "ayonto_emailsubject",
                "ayonto_emailbody",
                "ayonto_emaillinktext",
                "ayonto_teamsenabled",
                "ayonto_teamstitle",
                "ayonto_teamsbody",
                "ayonto_teamslinktext",
                "ayonto_inappenabled",
                "ayonto_inapptitle",
                "ayonto_inappbody",
                "ayonto_inapplinktext",
            };

            Assert.Equal(expected, new HashSet<string>(Assert.Single(service.Created).Attributes.Keys, StringComparer.Ordinal));
        }

        [Fact]
        public void the_name_is_a_label_and_carries_no_identifier()
        {
            var service = new FakeOrganizationService();
            MentionEventRow row = Row(NotificationConfiguration.Silent);

            new MentionEventLedger(service).Create(row);

            var label = (string)Assert.Single(service.Created)["ayonto_name"];
            Assert.Contains(Table, label);
            Assert.Contains(Field, label);
            Assert.DoesNotContain(row.Identity.EventId, label);
            Assert.DoesNotContain(row.Identity.RecipientUserId, label);
            Assert.DoesNotContain(row.Identity.RecordId, label);
            Assert.True(label.Length <= MentionEventColumns.NameLength);
        }

        [Fact]
        public void a_label_longer_than_the_column_is_cut_rather_than_refused()
        {
            var service = new FakeOrganizationService();
            var identity = new MentionEventIdentity(
                Payloads.NewId(),
                new string('t', 128),
                Payloads.NewId(),
                new string('f', 128),
                Payloads.NewId());

            new MentionEventLedger(service).Create(
                new MentionEventRow(identity, Payloads.NewId(), NotificationConfiguration.Silent));

            var label = (string)Assert.Single(service.Created)["ayonto_name"];
            Assert.Equal(MentionEventColumns.NameLength, label.Length);
        }

        [Fact]
        public void looks_events_up_by_their_identifier_and_reads_the_whole_identity()
        {
            string eventId = Payloads.NewId();
            var existing = new Entity("ayonto_mentionevent", Guid.NewGuid());
            existing["ayonto_eventid"] = eventId;
            existing["ayonto_recordtable"] = Table;
            existing["ayonto_recordid"] = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
            existing["ayonto_sourcefield"] = Field;
            existing["ayonto_recipientuserid"] = "1f2504e0-4f89-41d3-9a0c-0305e82c3302";
            var service = new FakeOrganizationService().Answer("ayonto_mentionevent", existing);

            IReadOnlyList<MentionEventIdentity> found = new MentionEventLedger(service).WithEventId(eventId);

            MentionEventIdentity identity = Assert.Single(found);
            Assert.Equal(eventId, identity.EventId);
            Assert.Equal(Table, identity.RecordTable);
            Assert.Equal(Field, identity.SourceField);
            Assert.Equal("1f2504e0-4f89-41d3-9a0c-0305e82c3302", identity.RecipientUserId);

            QueryExpression query = Assert.Single(service.Queries);
            Assert.Equal("ayonto_mentionevent", query.EntityName);
            Assert.Equal("ayonto_eventid", Assert.Single(query.Criteria.Conditions).AttributeName);
        }

        [Fact]
        public void no_identifier_is_no_query()
        {
            var service = new FakeOrganizationService();

            Assert.Empty(new MentionEventLedger(service).WithEventId(null));
            Assert.Empty(new MentionEventLedger(service).WithEventId("  "));
            Assert.Empty(service.Queries);
        }

        [Fact]
        public void identity_is_all_five_values_compared_exactly()
        {
            string eventId = Payloads.NewId();
            string recipient = Payloads.NewId();
            string recordId = Payloads.NewId();

            var identity = new MentionEventIdentity(eventId, Table, recordId, Field, recipient);

            Assert.True(identity.Matches(new MentionEventIdentity(eventId, Table, recordId, Field, recipient)));
            Assert.False(identity.Matches(new MentionEventIdentity(Payloads.NewId(), Table, recordId, Field, recipient)));
            Assert.False(identity.Matches(new MentionEventIdentity(eventId, "other", recordId, Field, recipient)));
            Assert.False(identity.Matches(new MentionEventIdentity(eventId, Table, Payloads.NewId(), Field, recipient)));
            Assert.False(identity.Matches(new MentionEventIdentity(eventId, Table, recordId, "other", recipient)));
            Assert.False(identity.Matches(new MentionEventIdentity(eventId, Table, recordId, Field, Payloads.NewId())));
            Assert.False(identity.Matches(null));
        }
    }
}
