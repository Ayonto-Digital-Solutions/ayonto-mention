using System.Collections.Generic;

namespace Ayonto.Mention.Ingest.Payload
{
    /// <summary>
    /// The companion payload, parsed and validated: which column it belongs to, and
    /// the mention claims it carries.
    /// </summary>
    public sealed class CompanionPayload
    {
        public CompanionPayload(string sourceField, IReadOnlyList<MentionClaim> mentions)
        {
            SourceField = sourceField;
            Mentions = mentions;
        }

        /// <summary>
        /// The text column these mentions were written in, as the payload named it —
        /// and accepted only because it matched the mapping the host declared on its
        /// own step. The payload does not get to say which column it is for.
        /// </summary>
        public string SourceField { get; }

        public IReadOnlyList<MentionClaim> Mentions { get; }
    }
}
