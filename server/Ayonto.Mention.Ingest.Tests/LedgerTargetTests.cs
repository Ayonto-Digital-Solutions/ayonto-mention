using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Ayonto.Mention.Ingest.Ledger;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The regression guard: this ingest writes `ayonto_mentionevent`, and the legacy
    /// `ayonto_mention` table must never appear as a target anywhere in it.
    ///
    /// The two are one letter of a suffix apart, they live in the same solution, and for
    /// a while the second one was what everybody meant by "the mention table". That is
    /// exactly the kind of mistake a review misses and a test should not: a query or a
    /// create naming the legacy table would compile, run, and put notification state back
    /// in a table whose trust model this code exists to replace.
    ///
    /// Two halves. `FakeOrganizationService` refuses the legacy table at runtime, so every
    /// test that touches Dataverse already guards it. This one reads the ingest's own
    /// sources — embedded into this assembly at build time — and looks for the string
    /// literal, which catches a path no test happens to exercise.
    /// </summary>
    public sealed class LedgerTargetTests
    {
        private const string SourcePrefix = "IngestSource.";

        private static IReadOnlyDictionary<string, string> IngestSources()
        {
            var sources = new Dictionary<string, string>(StringComparer.Ordinal);
            Assembly assembly = typeof(LedgerTargetTests).Assembly;

            foreach (string resource in assembly.GetManifestResourceNames())
            {
                if (!resource.StartsWith(SourcePrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                using (Stream stream = assembly.GetManifestResourceStream(resource))
                using (var reader = new StreamReader(stream))
                {
                    sources.Add(resource.Substring(SourcePrefix.Length), reader.ReadToEnd());
                }
            }

            return sources;
        }

        [Fact]
        public void the_ingest_sources_are_embedded_so_that_this_test_means_something()
        {
            IReadOnlyDictionary<string, string> sources = IngestSources();

            Assert.True(sources.Count >= 20, "expected the ingest's sources, found " + sources.Count);
            Assert.True(sources.ContainsKey("MentionEventLedger.cs"));
            Assert.True(sources.ContainsKey("MentionIngest.cs"));
            Assert.True(sources.ContainsKey("MentionIngestPlugin.cs"));
        }

        [Fact]
        public void no_source_file_names_the_legacy_table_as_a_string_literal_it_could_write()
        {
            // The literal, with its quotes. Comments and the constant that exists to be
            // named by this test are prose; a quoted logical name is something a query or
            // an entity could be built from.
            const string literal = "\"ayonto_mention\"";
            var offenders = new List<string>();

            foreach (KeyValuePair<string, string> source in IngestSources())
            {
                if (source.Key == "MentionEventColumns.cs")
                {
                    // The one place it is allowed to appear: the constant that names the
                    // table this ingest must not write, so that tests can assert against
                    // it. Checked separately below.
                    continue;
                }

                if (source.Value.IndexOf(literal, StringComparison.Ordinal) >= 0)
                {
                    offenders.Add(source.Key);
                }
            }

            Assert.Empty(offenders);
        }

        [Fact]
        public void the_legacy_table_appears_once_and_only_as_the_table_this_ingest_avoids()
        {
            string columns = IngestSources()["MentionEventColumns.cs"];

            Assert.Contains("LegacyTableLogicalName = \"ayonto_mention\"", columns);
            Assert.Equal("ayonto_mention", MentionEventColumns.LegacyTableLogicalName);
            Assert.Equal("ayonto_mentionevent", MentionEventColumns.TableLogicalName);
            Assert.NotEqual(MentionEventColumns.TableLogicalName, MentionEventColumns.LegacyTableLogicalName);
        }

        [Fact]
        public void every_column_the_ingest_writes_belongs_to_the_event_table()
        {
            foreach (string column in new[]
            {
                MentionEventColumns.Name,
                MentionEventColumns.EventId,
                MentionEventColumns.RecordTable,
                MentionEventColumns.RecordId,
                MentionEventColumns.SourceField,
                MentionEventColumns.RecipientUserId,
                MentionEventColumns.InitiatingUserId,
                MentionEventColumns.ConfigSchemaVersion,
                MentionEventColumns.EmailEnabled,
                MentionEventColumns.EmailSubject,
                MentionEventColumns.EmailBody,
                MentionEventColumns.EmailLinkText,
                MentionEventColumns.TeamsEnabled,
                MentionEventColumns.TeamsTitle,
                MentionEventColumns.TeamsBody,
                MentionEventColumns.TeamsLinkText,
                MentionEventColumns.InAppEnabled,
                MentionEventColumns.InAppTitle,
                MentionEventColumns.InAppBody,
                MentionEventColumns.InAppLinkText,
            })
            {
                Assert.StartsWith("ayonto_", column);
                Assert.Equal(column.ToLowerInvariant(), column);
            }
        }
    }
}
