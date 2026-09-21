using Ayonto.Mention.Ingest.Payload;
using Ayonto.Mention.Ingest.Tests.Support;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// What the ingest believes out of a column anybody who may write the text may
    /// write. The two levels are what these tests are about: a shape this product did
    /// not write ends the whole payload, while a claim the committed text no longer
    /// carries drops that claim and leaves the rest standing.
    /// </summary>
    public sealed class CompanionPayloadParserTests
    {
        private const string Field = "description";
        private const string Text = "ask @Alex Rivera and @Dana Winter";
        private static readonly int AlexStart = Text.IndexOf("@Alex", System.StringComparison.Ordinal);
        private static readonly int DanaStart = Text.IndexOf("@Dana", System.StringComparison.Ordinal);

        private static CompanionPayload Valid(string raw, string text = Text)
        {
            CompanionPayloadResult result = CompanionPayloadParser.Read(raw, Field, text);
            Assert.Equal(CompanionPayloadStatus.Valid, result.Status);
            return result.Payload;
        }

        private static string Invalid(string raw, string text = Text)
        {
            CompanionPayloadResult result = CompanionPayloadParser.Read(raw, Field, text);
            Assert.Equal(CompanionPayloadStatus.Invalid, result.Status);
            Assert.Null(result.Payload);
            Assert.False(string.IsNullOrWhiteSpace(result.Problem));
            return result.Problem;
        }

        [Fact]
        public void reads_a_version_one_payload()
        {
            string alex = Payloads.NewId();
            string alexUser = Payloads.NewId();

            CompanionPayload payload = Valid(
                Payloads.Metadata(Field, Payloads.Mention(alex, alexUser, AlexStart, 12)));

            Assert.Equal(Field, payload.SourceField);
            MentionClaim claim = Assert.Single(payload.Mentions);
            Assert.Equal(alex, claim.EventId);
            Assert.Equal(alexUser, claim.RecipientUserId);
            MentionOccurrence occurrence = Assert.Single(claim.Occurrences);
            Assert.Equal(AlexStart, occurrence.Start);
            Assert.Equal(12, occurrence.Length);
        }

        [Fact]
        public void reads_two_people_in_one_payload()
        {
            CompanionPayload payload = Valid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12),
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), DanaStart, 12)));

            Assert.Equal(2, payload.Mentions.Count);
        }

        [Fact]
        public void an_empty_column_is_a_record_with_no_mentions_rather_than_a_problem()
        {
            Assert.Equal(CompanionPayloadStatus.Absent, CompanionPayloadParser.Read(null, Field, Text).Status);
            Assert.Equal(CompanionPayloadStatus.Absent, CompanionPayloadParser.Read("   ", Field, Text).Status);
        }

        [Fact]
        public void refuses_a_schema_version_it_does_not_know()
        {
            Assert.Contains(
                "not supported",
                Invalid(Payloads.Metadata(2, Field, Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12))));
        }

        [Fact]
        public void refuses_a_payload_with_no_schema_version()
        {
            Assert.Contains("schemaVersion", Invalid("{\"sourceField\":\"description\",\"mentions\":[]}"));
        }

        [Fact]
        public void refuses_a_payload_naming_a_column_the_step_did_not_map_to_it()
        {
            // The payload does not get to say which column it is for. That comes from
            // the mapping the host declared on its own step.
            Assert.Contains(
                "source column this step did not map",
                Invalid(Payloads.Metadata("ayonto_other", Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12))));
        }

        [Fact]
        public void refuses_an_event_identifier_that_is_not_a_guid()
        {
            Assert.Contains(
                "eventId",
                Invalid(Payloads.Metadata(Field, Payloads.Mention("not-a-guid", Payloads.NewId(), AlexStart, 12))));
        }

        [Fact]
        public void refuses_a_recipient_that_is_not_a_guid()
        {
            Assert.Contains(
                "recipientUserId",
                Invalid(Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), "alex@example.com", AlexStart, 12))));
        }

        [Fact]
        public void refuses_the_empty_guid_as_an_identity()
        {
            const string empty = "00000000-0000-0000-0000-000000000000";

            Invalid(Payloads.Metadata(Field, Payloads.Mention(empty, Payloads.NewId(), AlexStart, 12)));
            Invalid(Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), empty, AlexStart, 12)));
        }

        [Fact]
        public void refuses_one_recipient_claimed_twice()
        {
            string user = Payloads.NewId();

            Assert.Contains("claimed twice", Invalid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), user, AlexStart, 12),
                Payloads.Mention(Payloads.NewId(), user, DanaStart, 12))));
        }

        [Fact]
        public void refuses_two_occurrences_claiming_the_same_text()
        {
            Assert.Contains("the same text", Invalid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12),
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12))));
        }

        [Theory]
        [InlineData("not json at all")]
        [InlineData("[]")]
        [InlineData("{\"schemaVersion\":1,\"sourceField\":\"description\"}")]
        [InlineData("{\"schemaVersion\":1,\"sourceField\":\"description\",\"mentions\":{}}")]
        [InlineData("{\"schemaVersion\":1,\"sourceField\":\"description\",\"mentions\":[1]}")]
        public void refuses_a_shape_this_product_did_not_write(string raw)
        {
            Invalid(raw);
        }

        [Fact]
        public void refuses_occurrences_that_are_not_an_array_of_spans()
        {
            string event1 = Payloads.NewId();
            string user1 = Payloads.NewId();

            Assert.Contains("occurrences is not an array", Invalid(
                "{\"schemaVersion\":1,\"sourceField\":\"description\",\"mentions\":[{\"eventId\":\""
                + event1 + "\",\"recipientUserId\":\"" + user1 + "\",\"occurrences\":\"0\"}]}"));

            Assert.Contains("no readable start and length", Invalid(
                "{\"schemaVersion\":1,\"sourceField\":\"description\",\"mentions\":[{\"eventId\":\""
                + event1 + "\",\"recipientUserId\":\"" + user1 + "\",\"occurrences\":[{\"start\":\"0\",\"length\":12}]}]}"));
        }

        [Fact]
        public void drops_a_claim_whose_position_lies_outside_the_committed_text()
        {
            // A record edited by something that never saw this control. Nothing is
            // wrong with the payload; the text simply moved on.
            CompanionPayload payload = Valid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), 900, 12)));

            Assert.Empty(payload.Mentions);
        }

        [Fact]
        public void drops_a_claim_whose_position_no_longer_reads_as_a_mention()
        {
            CompanionPayload payload = Valid(
                Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12)),
                "ask alex rivera and nobody else");

            Assert.Empty(payload.Mentions);
        }

        [Fact]
        public void keeps_the_occurrences_that_still_stand_and_drops_the_ones_that_do_not()
        {
            CompanionPayload payload = Valid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId(), AlexStart, 12, 900, 12)));

            MentionClaim claim = Assert.Single(payload.Mentions);
            Assert.Single(claim.Occurrences);
            Assert.Equal(AlexStart, claim.Occurrences[0].Start);
        }

        [Fact]
        public void one_person_mentioned_twice_in_one_episode_is_one_claim()
        {
            const string text = "@Alex Rivera and @Alex Rivera again";
            int first = 0;
            int second = text.LastIndexOf("@Alex", System.StringComparison.Ordinal);

            CompanionPayload payload = Valid(
                Payloads.Metadata(Field, Payloads.Mention(Payloads.NewId(), Payloads.NewId(), first, 12, second, 12)),
                text);

            MentionClaim claim = Assert.Single(payload.Mentions);
            Assert.Equal(2, claim.Occurrences.Count);
            Assert.Equal(first, claim.Occurrences[0].Start);
            Assert.Equal(second, claim.Occurrences[1].Start);
        }

        [Fact]
        public void a_claim_with_no_occurrences_at_all_names_nobody_the_text_names()
        {
            CompanionPayload payload = Valid(Payloads.Metadata(
                Field,
                Payloads.Mention(Payloads.NewId(), Payloads.NewId())));

            Assert.Empty(payload.Mentions);
        }

        [Fact]
        public void accepts_the_identifier_spellings_it_normalizes()
        {
            string canonical = Payloads.NewId();

            CompanionPayload payload = Valid(Payloads.Metadata(
                Field,
                Payloads.Mention(canonical.ToUpperInvariant(), "{" + canonical + "}", AlexStart, 12)));

            MentionClaim claim = Assert.Single(payload.Mentions);
            Assert.Equal(canonical, claim.EventId);
            Assert.Equal(canonical, claim.RecipientUserId);
        }
    }
}
