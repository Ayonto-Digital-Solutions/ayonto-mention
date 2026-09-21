using Ayonto.Mention.Ingest.Json;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The reader's strictness, which is the part of it that is a security property
    /// rather than a convenience. Everything a lenient reader would accept and quietly
    /// reinterpret is refused here instead.
    /// </summary>
    public sealed class JsonReaderTests
    {
        private static JsonValue Read(string text)
        {
            JsonValue value;
            string problem;
            Assert.True(JsonReader.TryRead(text, out value, out problem), problem);
            return value;
        }

        private static string Refuse(string text)
        {
            JsonValue value;
            string problem;
            Assert.False(JsonReader.TryRead(text, out value, out problem), text);
            Assert.Null(value);
            Assert.False(string.IsNullOrWhiteSpace(problem));
            return problem;
        }

        [Fact]
        public void reads_the_payload_shape_this_product_writes()
        {
            JsonValue document = Read("{\"schemaVersion\":1,\"mentions\":[{\"start\":0,\"length\":12}]}");

            int version;
            Assert.True(document.Member("schemaVersion").TryReadInt32(out version));
            Assert.Equal(1, version);
            Assert.Equal(JsonKind.Array, document.Member("mentions").Kind);
            Assert.Single(document.Member("mentions").Items);
        }

        [Fact]
        public void reads_strings_with_escapes()
        {
            string text;
            Assert.True(Read("{\"a\":\"line\\nbreak \\u00e4 \\\" \\\\\"}").Member("a").TryReadString(out text));
            Assert.Equal("line\nbreak ä \" \\", text);
        }

        [Fact]
        public void refuses_a_member_named_twice_rather_than_picking_one()
        {
            Assert.Contains("named twice", Refuse("{\"eventId\":\"a\",\"eventId\":\"b\"}"));
        }

        [Fact]
        public void refuses_trailing_content()
        {
            Assert.Contains("trailing content", Refuse("{} {}"));
        }

        [Theory]
        [InlineData("{'a':1}")]
        [InlineData("{a:1}")]
        [InlineData("{\"a\":1,}")]
        [InlineData("[1,]")]
        [InlineData("{\"a\":1} // comment")]
        [InlineData("NaN")]
        [InlineData("Infinity")]
        [InlineData("{\"a\":01}")]
        [InlineData("{\"a\":+1}")]
        [InlineData("{\"a\":.5}")]
        [InlineData("{\"a\":1.}")]
        [InlineData("{\"a\":1e}")]
        public void refuses_what_is_not_json(string text)
        {
            Refuse(text);
        }

        [Fact]
        public void refuses_an_unescaped_control_character_in_a_string()
        {
            Assert.Contains("control character", Refuse("{\"a\":\"two\nlines\"}"));
        }

        [Fact]
        public void refuses_a_malformed_unicode_escape()
        {
            Assert.Contains("\\u escape", Refuse("{\"a\":\"\\u12\"}"));
        }

        [Fact]
        public void refuses_a_document_nested_deeper_than_it_allows()
        {
            string deep = new string('[', JsonReader.MaximumDepth + 2) + new string(']', JsonReader.MaximumDepth + 2);

            Assert.Contains("nested deeper", Refuse(deep));
        }

        [Fact]
        public void refuses_a_document_longer_than_it_allows()
        {
            Assert.Contains("longer than", Refuse("\"" + new string('a', JsonReader.MaximumLength) + "\""));
        }

        [Fact]
        public void refuses_no_value_at_all()
        {
            Refuse(null);
            Refuse("");
        }

        [Fact]
        public void a_whole_number_is_a_whole_number_however_it_was_written()
        {
            int value;
            Assert.True(Read("{\"a\":12}").Member("a").TryReadInt32(out value));
            Assert.Equal(12, value);
            Assert.True(Read("{\"a\":1.2e1}").Member("a").TryReadInt32(out value));
            Assert.Equal(12, value);
        }

        [Fact]
        public void a_fraction_is_not_a_position()
        {
            int value;
            Assert.False(Read("{\"a\":1.5}").Member("a").TryReadInt32(out value));
            Assert.False(Read("{\"a\":1e30}").Member("a").TryReadInt32(out value));
        }

        [Fact]
        public void nothing_is_coerced_between_kinds()
        {
            JsonValue document = Read("{\"number\":\"12\",\"string\":12,\"boolean\":\"true\"}");

            int number;
            string text;
            bool flag;
            Assert.False(document.Member("number").TryReadInt32(out number));
            Assert.False(document.Member("string").TryReadString(out text));
            Assert.False(document.Member("boolean").TryReadBoolean(out flag));
        }

        [Fact]
        public void a_member_that_is_not_there_is_null_rather_than_an_error()
        {
            Assert.Null(Read("{}").Member("missing"));
            Assert.Empty(Read("{}").Items);
            Assert.Empty(Read("[]").Members);
        }
    }
}
