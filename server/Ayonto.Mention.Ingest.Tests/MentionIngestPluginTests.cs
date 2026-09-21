using System;
using Ayonto.Mention.Ingest.Tests.Fakes;
using Ayonto.Mention.Ingest.Tests.Support;
using Microsoft.Xrm.Sdk;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The plug-in itself: the registration it insists on, the images it needs, and the
    /// one end-to-end run through real collaborators against a fake Dataverse.
    ///
    /// The asymmetry between asynchronous and synchronous is the part worth reading.
    /// Registered asynchronously, a registration mistake throws — the record is already
    /// committed, the system job fails visibly, and a notification pipeline that quietly
    /// does nothing is worse than one that says it is broken. Registered synchronously, a
    /// throw would roll back somebody's business record over a notification defect, so it
    /// traces and returns instead.
    /// </summary>
    public sealed class MentionIngestPluginTests
    {
        private const string Table = "ayonto_hosttable";
        private const string Field = "description";
        private const string MetadataField = "ayonto_descriptionmentions";
        private const string Mapping = Field + "=" + MetadataField;
        private const string Text = "ask @Alex Rivera about it";

        private readonly FakeTracingService _trace = new FakeTracingService();
        private readonly FakeOrganizationService _service = new FakeOrganizationService();
        private readonly FakePluginExecutionContext _context = new FakePluginExecutionContext();

        private FakeOrganizationServiceFactory _factory;

        private IServiceProvider Provider()
        {
            _factory = new FakeOrganizationServiceFactory(_service);
            return new FakeServiceProvider(_context, _trace, _factory);
        }

        private static Entity Image(params string[] columnsAndValues)
        {
            var image = new Entity(Table);
            for (int at = 0; at + 1 < columnsAndValues.Length; at += 2)
            {
                image[columnsAndValues[at]] = columnsAndValues[at + 1];
            }

            return image;
        }

        private void WithImages(Entity post, Entity pre)
        {
            if (post != null)
            {
                _context.PostEntityImages.Add("PostImage", post);
            }
            if (pre != null)
            {
                _context.PreEntityImages.Add("PreImage", pre);
            }
        }

        private void Run(string unsecureConfiguration = Mapping)
        {
            new MentionIngestPlugin(unsecureConfiguration, null).Execute(Provider());
        }

        private void Refuses(string expected, string unsecureConfiguration = Mapping)
        {
            InvalidPluginExecutionException thrown = Assert.Throws<InvalidPluginExecutionException>(
                () => Run(unsecureConfiguration));

            Assert.Contains(expected, thrown.Message, StringComparison.OrdinalIgnoreCase);
            Assert.Empty(_service.Created);
        }

        [Fact]
        public void creates_an_event_for_a_committed_mention()
        {
            Guid user = Guid.NewGuid();
            string eventId = Payloads.NewId();
            var userRow = new Entity("systemuser", user);
            userRow["isdisabled"] = false;
            var form = new Entity("systemform", Guid.NewGuid());
            form["name"] = "Main";
            form["formxml"] = Forms.With(Field, Forms.EmailOnly());
            _service.Answer("systemform", form).Answer("systemuser", userRow);

            _context.MessageName = "Create";
            _context.PrimaryEntityName = Table;
            WithImages(
                Image(
                    Field, Text,
                    MetadataField, Payloads.Metadata(
                        Field,
                        Payloads.Mention(eventId, user.ToString("D"), 4, 12))),
                null);

            Run();

            Entity created = Assert.Single(_service.Created);
            Assert.Equal("ayonto_mentionevent", created.LogicalName);
            Assert.Equal(eventId, created["ayonto_eventid"]);
            Assert.Equal(Table, created["ayonto_recordtable"]);
            Assert.Equal(Field, created["ayonto_sourcefield"]);
            Assert.Equal(user.ToString("D").ToLowerInvariant(), created["ayonto_recipientuserid"]);
            Assert.Equal(
                _context.InitiatingUserId.ToString("D").ToLowerInvariant(),
                created["ayonto_initiatinguserid"]);
            Assert.Equal(true, created["ayonto_emailenabled"]);
            Assert.Equal("You were mentioned", created["ayonto_emailsubject"]);
        }

        [Fact]
        public void the_ledger_is_written_as_system()
        {
            // null is the SYSTEM user, which is what lets an ordinary user save a host
            // record without holding Create on the ledger.
            _context.MessageName = "Create";
            WithImages(Image(Field, Text), null);

            Run();

            Assert.Null(Assert.Single(_factory.AskedFor));
        }

        [Fact]
        public void an_update_reads_both_images()
        {
            string payload = Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), 4, 12));
            WithImages(Image(Field, Text, MetadataField, payload), Image(MetadataField, payload));

            Run();

            Assert.Empty(_service.Created);
            Assert.True(_trace.Said("unchanged"));
        }

        [Fact]
        public void refuses_a_message_it_was_not_written_for()
        {
            _context.MessageName = "Delete";

            Refuses("handles Create and Update");
        }

        [Fact]
        public void refuses_a_stage_that_is_not_postoperation()
        {
            _context.Stage = 20;

            Refuses("PostOperation step");
        }

        [Fact]
        public void a_synchronous_registration_is_reported_and_never_thrown()
        {
            _context.Mode = 0;
            WithImages(Image(Field, Text), null);

            Run();

            Assert.Empty(_service.Created);
            Assert.True(_trace.Said("must be asynchronous"));
        }

        [Fact]
        public void refuses_a_step_with_no_column_mapping()
        {
            WithImages(Image(Field, Text), Image());

            Refuses("not a column mapping", null);
            Refuses("not a column mapping", "nonsense");
        }

        [Fact]
        public void refuses_a_step_with_no_post_image()
        {
            WithImages(null, Image());

            Refuses("no post image registered");
        }

        [Fact]
        public void refuses_an_update_step_with_no_pre_image()
        {
            // Without it, an update that changed the mentions cannot be told from one
            // that merely carried the column along — and a filtering attribute does not
            // tell it either.
            WithImages(Image(Field, Text), null);

            Refuses("no pre image registered");
        }

        [Fact]
        public void a_create_needs_no_pre_image()
        {
            _context.MessageName = "Create";
            WithImages(Image(Field, Text), null);

            Run();

            Assert.Empty(_service.Created);
        }

        [Fact]
        public void refuses_an_image_under_an_alias_it_does_not_know()
        {
            _context.MessageName = "Create";
            _context.PostEntityImages.Add("Target", Image(Field, Text));

            Refuses("PostImage");
        }

        [Fact]
        public void refuses_an_execution_context_that_names_no_record()
        {
            _context.MessageName = "Create";
            _context.PrimaryEntityId = Guid.Empty;
            WithImages(Image(Field, Text), null);

            Refuses("names no primary record");
        }

        [Fact]
        public void refuses_to_run_without_the_services_a_plug_in_is_given()
        {
            var provider = new FakeServiceProvider(_context, _trace, null);

            Assert.Throws<InvalidPluginExecutionException>(
                () => new MentionIngestPlugin(Mapping, null).Execute(provider));
            Assert.Throws<ArgumentNullException>(
                () => new MentionIngestPlugin(Mapping, null).Execute(null));
        }

        [Fact]
        public void the_table_and_the_record_come_from_the_execution_context_and_not_from_the_payload()
        {
            Guid user = Guid.NewGuid();
            var userRow = new Entity("systemuser", user);
            userRow["isdisabled"] = false;
            var form = new Entity("systemform", Guid.NewGuid());
            form["formxml"] = Forms.With(Field, Forms.EmailOnly());
            _service.Answer("systemform", form).Answer("systemuser", userRow);

            _context.MessageName = "Create";
            _context.PrimaryEntityName = "AYONTO_HostTable";
            WithImages(
                Image(
                    Field, Text,
                    MetadataField, Payloads.Metadata(
                        Field,
                        Payloads.Mention(Payloads.NewId(), user.ToString("D"), 4, 12))),
                null);

            Run();

            Entity created = Assert.Single(_service.Created);
            Assert.Equal("ayonto_hosttable", created["ayonto_recordtable"]);
            Assert.Equal(
                _context.PrimaryEntityId.ToString("D").ToLowerInvariant(),
                created["ayonto_recordid"]);
        }

        [Fact]
        public void a_column_that_is_not_text_arrives_as_nothing_rather_than_as_a_value()
        {
            _context.MessageName = "Create";
            var post = new Entity(Table);
            post[Field] = 42;
            post[MetadataField] = new EntityReference("systemuser", Guid.NewGuid());
            WithImages(post, null);

            Run();

            Assert.Empty(_service.Created);
            Assert.Empty(_service.Queries);
        }
    }
}
