using System;
using System.Collections.Generic;
using System.Globalization;

namespace Ayonto.Mention.Ingest.Configuration
{
    /// <summary>
    /// The step's unsecure configuration: which text column each companion metadata
    /// column belongs to, on this one host table.
    ///
    /// The format is one mapping per line, `sourceField=metadataField`. Blank lines
    /// and `#` comments are skipped, and nothing else is tolerated — a format that
    /// accepts almost anything is a format where a typo becomes a column nobody
    /// reads. Names are lowered before they are checked, because Dataverse logical
    /// names are lower case and a maker typing `Description` into a registration has
    /// made no mistake worth failing over.
    ///
    /// What this configuration may and may not carry is part of the design rather
    /// than a convention. It declares the mapping and nothing else: no notification
    /// text, no e-mail address, no recipient. Notification configuration is resolved
    /// server-side from published form metadata, per record table and source field,
    /// and a recipient is resolved against `systemuser`. Putting either here would
    /// make a step registration into delivery authority, and the point of resolving
    /// those elsewhere is that they are not.
    ///
    /// The unsecure half is deliberate too: secure configuration "isn't included with
    /// the step registration when you export a solution", and this mapping is part
    /// of the declaration the host ships rather than a secret.
    /// https://learn.microsoft.com/power-apps/developer/data-platform/register-plug-in
    /// </summary>
    public sealed class StepConfiguration
    {
        private readonly IReadOnlyList<FieldMapping> _mappings;

        private StepConfiguration(IReadOnlyList<FieldMapping> mappings)
        {
            _mappings = mappings;
        }

        /// <summary>The mappings, in the order the configuration declared them.</summary>
        public IReadOnlyList<FieldMapping> Mappings
        {
            get { return _mappings; }
        }

        /// <summary>
        /// Reads a step's unsecure configuration, or says what is wrong with it.
        ///
        /// Everything is refused rather than repaired: an empty configuration, a line
        /// that is not a mapping, a name that is not a logical name, a source column
        /// mapped twice, one companion column claimed by two source columns, and a
        /// column mapped to itself. Each of those is a registration a person made,
        /// and each of them would otherwise produce a handler that runs and does
        /// something subtly different from what the person meant.
        /// </summary>
        /// <param name="unsecureConfiguration">The step's unsecure configuration.</param>
        /// <param name="configuration">The parsed mappings.</param>
        /// <param name="problem">A short description of the first thing found wrong.</param>
        public static bool TryParse(
            string unsecureConfiguration,
            out StepConfiguration configuration,
            out string problem)
        {
            configuration = null;
            problem = null;

            if (string.IsNullOrWhiteSpace(unsecureConfiguration))
            {
                problem = "the step has no unsecure configuration, so no column mapping is declared";
                return false;
            }

            var mappings = new List<FieldMapping>();
            var sourceFields = new HashSet<string>(StringComparer.Ordinal);
            var metadataFields = new HashSet<string>(StringComparer.Ordinal);

            string[] lines = unsecureConfiguration.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            for (int index = 0; index < lines.Length; index++)
            {
                string line = lines[index].Trim();
                if (line.Length == 0 || line[0] == '#')
                {
                    continue;
                }

                string where = "line " + (index + 1).ToString(CultureInfo.InvariantCulture);

                string[] halves = line.Split('=');
                if (halves.Length != 2)
                {
                    problem = where + " is not one 'sourceField=metadataField' mapping";
                    return false;
                }

                string sourceField = halves[0].Trim().ToLowerInvariant();
                string metadataField = halves[1].Trim().ToLowerInvariant();

                if (!LogicalNames.IsWellFormed(sourceField))
                {
                    problem = where + " does not name a source column";
                    return false;
                }
                if (!LogicalNames.IsWellFormed(metadataField))
                {
                    problem = where + " does not name a companion column";
                    return false;
                }
                if (string.Equals(sourceField, metadataField, StringComparison.Ordinal))
                {
                    problem = where + " maps a column to itself";
                    return false;
                }
                if (!sourceFields.Add(sourceField))
                {
                    problem = where + " maps a source column that is already mapped";
                    return false;
                }
                if (!metadataFields.Add(metadataField))
                {
                    // One column holds one value. Two source columns sharing a
                    // companion column would overwrite each other's mentions, and
                    // the second save would notify whoever the first one meant.
                    problem = where + " reuses a companion column another source column already claims";
                    return false;
                }

                mappings.Add(new FieldMapping(sourceField, metadataField));
            }

            if (mappings.Count == 0)
            {
                problem = "the step's unsecure configuration declares no mapping";
                return false;
            }

            configuration = new StepConfiguration(mappings);
            return true;
        }
    }
}
