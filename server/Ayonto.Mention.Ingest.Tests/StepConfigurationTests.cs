using Ayonto.Mention.Ingest.Configuration;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The step's column mapping, which is the only thing a host declares in code this
    /// product wrote. Everything here is a registration somebody typed, so every
    /// refusal names what a person did rather than what a parser found.
    /// </summary>
    public sealed class StepConfigurationTests
    {
        private static StepConfiguration Parse(string configuration)
        {
            StepConfiguration parsed;
            string problem;
            Assert.True(StepConfiguration.TryParse(configuration, out parsed, out problem), problem);
            return parsed;
        }

        private static string Refuse(string configuration)
        {
            StepConfiguration parsed;
            string problem;
            Assert.False(StepConfiguration.TryParse(configuration, out parsed, out problem));
            Assert.Null(parsed);
            Assert.False(string.IsNullOrWhiteSpace(problem));
            return problem;
        }

        [Fact]
        public void reads_one_mapping()
        {
            StepConfiguration configuration = Parse("description=ayonto_descriptionmentions");

            FieldMapping mapping = Assert.Single(configuration.Mappings);
            Assert.Equal("description", mapping.SourceField);
            Assert.Equal("ayonto_descriptionmentions", mapping.MetadataField);
        }

        [Fact]
        public void reads_several_mappings_because_one_table_may_have_several_mention_fields()
        {
            StepConfiguration configuration = Parse(
                "description=ayonto_descriptionmentions\nayonto_notes=ayonto_notesmentions");

            Assert.Equal(2, configuration.Mappings.Count);
            Assert.Equal("description", configuration.Mappings[0].SourceField);
            Assert.Equal("ayonto_notes", configuration.Mappings[1].SourceField);
            Assert.Equal("ayonto_notesmentions", configuration.Mappings[1].MetadataField);
        }

        [Fact]
        public void skips_blank_lines_and_comments()
        {
            StepConfiguration configuration = Parse(
                "# the description field\r\n\r\ndescription=ayonto_descriptionmentions\r\n");

            Assert.Single(configuration.Mappings);
        }

        [Fact]
        public void lowers_names_because_dataverse_logical_names_are_lower_case()
        {
            StepConfiguration configuration = Parse("  Description = Ayonto_DescriptionMentions  ");

            Assert.Equal("description", configuration.Mappings[0].SourceField);
            Assert.Equal("ayonto_descriptionmentions", configuration.Mappings[0].MetadataField);
        }

        [Fact]
        public void refuses_a_step_with_no_configuration_at_all()
        {
            Assert.Contains("no unsecure configuration", Refuse(null));
            Assert.Contains("no unsecure configuration", Refuse("   "));
        }

        [Fact]
        public void refuses_a_configuration_that_declares_nothing()
        {
            Assert.Contains("declares no mapping", Refuse("# only a comment"));
        }

        [Theory]
        [InlineData("description")]
        [InlineData("description=a=b")]
        [InlineData("=ayonto_descriptionmentions")]
        [InlineData("description=")]
        public void refuses_a_line_that_is_not_a_mapping(string configuration)
        {
            Refuse(configuration);
        }

        [Theory]
        [InlineData("9description=ayonto_descriptionmentions")]
        [InlineData("descri ption=ayonto_descriptionmentions")]
        [InlineData("description=ayonto-descriptionmentions")]
        [InlineData("description=ayonto_description mentions")]
        public void refuses_a_name_that_is_not_a_logical_name(string configuration)
        {
            Refuse(configuration);
        }

        [Fact]
        public void refuses_a_name_longer_than_the_column_that_has_to_record_it()
        {
            string tooLong = "a" + new string('b', 128);

            Assert.Contains("source column", Refuse(tooLong + "=ayonto_descriptionmentions"));
        }

        [Fact]
        public void refuses_the_same_source_column_twice()
        {
            Assert.Contains(
                "already mapped",
                Refuse("description=ayonto_descriptionmentions\ndescription=ayonto_othermentions"));
        }

        [Fact]
        public void refuses_one_companion_column_claimed_by_two_source_columns()
        {
            // One column holds one value, so the second save would overwrite the
            // first one's mentions and notify the wrong person.
            Assert.Contains(
                "reuses a companion column",
                Refuse("description=ayonto_mentions\nayonto_notes=ayonto_mentions"));
        }

        [Fact]
        public void refuses_a_column_mapped_to_itself()
        {
            Assert.Contains("maps a column to itself", Refuse("description=description"));
        }
    }
}
