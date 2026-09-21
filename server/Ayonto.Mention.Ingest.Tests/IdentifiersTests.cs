using System;
using Ayonto.Mention.Ingest.Identity;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The one spelling identity is compared on. Two spellings of one GUID would be two
    /// recipients, and a replay would never match the event it is replaying.
    /// </summary>
    public sealed class IdentifiersTests
    {
        [Fact]
        public void normalizes_every_spelling_a_guid_can_arrive_in()
        {
            const string canonical = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

            foreach (string spelling in new[]
            {
                canonical,
                canonical.ToUpperInvariant(),
                "{" + canonical + "}",
                "(" + canonical + ")",
                "3f2504e04f8941d39a0c0305e82c3301",
                "  " + canonical + "  ",
            })
            {
                string normalized;
                Assert.True(Identifiers.TryNormalize(spelling, out normalized), spelling);
                Assert.Equal(canonical, normalized);
                Assert.Equal(Identifiers.CanonicalLength, normalized.Length);
            }
        }

        [Fact]
        public void refuses_the_empty_guid_because_it_names_nobody()
        {
            string normalized;
            Assert.False(Identifiers.TryNormalize("00000000-0000-0000-0000-000000000000", out normalized));
            Assert.Null(normalized);

            Guid parsed;
            Assert.False(Identifiers.TryParse("00000000-0000-0000-0000-000000000000", out parsed));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("not-a-guid")]
        [InlineData("3f2504e0-4f89-41d3-9a0c-0305e82c33")]
        public void refuses_what_is_not_an_identifier(string raw)
        {
            string normalized;
            Assert.False(Identifiers.TryNormalize(raw, out normalized));
        }

        [Fact]
        public void normalizes_a_platform_guid_to_the_same_spelling()
        {
            var value = Guid.Parse("3F2504E0-4F89-41D3-9A0C-0305E82C3301");

            Assert.Equal("3f2504e0-4f89-41d3-9a0c-0305e82c3301", Identifiers.Normalize(value));
        }
    }
}
