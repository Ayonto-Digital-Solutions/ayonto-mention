namespace Ayonto.Mention.Ingest.Configuration
{
    /// <summary>
    /// One mention-enabled text column and the companion column that carries its
    /// mentions.
    ///
    /// This pairing is knowledge the host has and the base product cannot infer, so
    /// it travels with the step the host registered rather than living in a central
    /// table this product would have to own. The step is authoritative because of
    /// who is able to create one — customization access — not because of what
    /// created it.
    /// </summary>
    public sealed class FieldMapping
    {
        public FieldMapping(string sourceField, string metadataField)
        {
            SourceField = sourceField;
            MetadataField = metadataField;
        }

        /// <summary>Logical name of the text column people write in.</summary>
        public string SourceField { get; }

        /// <summary>Logical name of the companion column the payload is written to.</summary>
        public string MetadataField { get; }
    }
}
