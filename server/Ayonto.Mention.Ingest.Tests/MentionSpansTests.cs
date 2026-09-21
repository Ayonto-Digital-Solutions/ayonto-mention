using Ayonto.Mention.Ingest.Text;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The structural rule an occurrence position is held to, which is the server's copy
    /// of what the editor itself would have produced. The cases are the ones the
    /// control's own tests care about, because the two rules have to stay one rule.
    /// </summary>
    public sealed class MentionSpansTests
    {
        [Fact]
        public void a_mention_at_the_start_of_the_text_reads_as_one()
        {
            Assert.True(MentionSpans.ReadsAsMention("@Alex Rivera said so", 0, 12));
        }

        [Fact]
        public void a_mention_behind_whitespace_or_a_bracket_reads_as_one()
        {
            Assert.True(MentionSpans.ReadsAsMention("ask @Alex Rivera", 4, 12));
            Assert.True(MentionSpans.ReadsAsMention("(@Alex Rivera)", 1, 12));
        }

        [Fact]
        public void the_at_of_an_email_address_does_not_open_a_mention()
        {
            Assert.False(MentionSpans.ReadsAsMention("alex@example.com", 4, 12));
        }

        [Fact]
        public void a_span_that_stops_inside_a_longer_name_is_not_a_mention()
        {
            // "@Alex Rivera" inside "@Alex RiveraX": drawing the first twelve
            // characters as a person would show a name the text does not have.
            Assert.False(MentionSpans.ReadsAsMention("@Alex RiveraX", 0, 12));
        }

        [Fact]
        public void a_mention_may_end_in_front_of_punctuation()
        {
            Assert.True(MentionSpans.ReadsAsMention("@Alex Rivera, please", 0, 12));
            Assert.True(MentionSpans.ReadsAsMention("@Alex Rivera.", 0, 12));
        }

        [Fact]
        public void a_mention_is_never_written_across_a_line_break()
        {
            Assert.False(MentionSpans.ReadsAsMention("@Alex\nRivera", 0, 12));
        }

        [Fact]
        public void a_span_that_does_not_start_at_an_at_sign_is_not_a_mention()
        {
            Assert.False(MentionSpans.ReadsAsMention("ask @Alex Rivera", 5, 11));
        }

        [Fact]
        public void a_span_needs_at_least_one_character_of_a_name()
        {
            Assert.False(MentionSpans.ReadsAsMention("@ hello", 0, 1));
            Assert.False(MentionSpans.ReadsAsMention("@ hello", 0, 0));
        }

        [Fact]
        public void a_span_outside_the_text_is_not_a_mention()
        {
            Assert.False(MentionSpans.ReadsAsMention("@Alex", 0, 12));
            Assert.False(MentionSpans.ReadsAsMention("@Alex", -1, 3));
            Assert.False(MentionSpans.ReadsAsMention("@Alex", 0, -3));
            Assert.False(MentionSpans.ReadsAsMention("@Alex", 2, int.MaxValue));
            Assert.False(MentionSpans.ReadsAsMention(null, 0, 3));
        }

        [Fact]
        public void the_whitespace_set_is_the_one_the_control_uses()
        {
            // A no-break space is whitespace in JavaScript and therefore here. The
            // point is not the character; it is that the two rules agree.
            Assert.True(MentionSpans.ReadsAsMention("ask\u00a0@Alex Rivera", 4, 12));
            Assert.True(MentionSpans.ReadsAsMention("@Alex Rivera\u00a0now", 0, 12));
            Assert.False(MentionSpans.ReadsAsMention("ask-@Alex Rivera", 4, 12));
        }
    }
}
