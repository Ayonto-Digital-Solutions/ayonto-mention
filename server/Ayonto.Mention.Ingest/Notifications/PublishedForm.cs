namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>
    /// One published form, as far as this product is concerned: what it is called,
    /// and the XML that describes it.
    ///
    /// The name travels with it only so a trace can say which form a configuration
    /// conflict is about. Nothing resolves anything from it.
    /// </summary>
    public sealed class PublishedForm
    {
        public PublishedForm(string formId, string name, string formXml)
        {
            FormId = formId;
            Name = name;
            FormXml = formXml;
        }

        public string FormId { get; }

        public string Name { get; }

        public string FormXml { get; }
    }

    /// <summary>
    /// Where the published forms of one table come from.
    ///
    /// An interface because the resolver's rules — one configuration per table and
    /// field, identical wherever it appears, fail closed where it is not — are worth
    /// testing without a Dataverse to read forms out of.
    /// </summary>
    public interface IPublishedFormSource
    {
        /// <summary>
        /// The published, active forms of one table, whatever their form type. Never
        /// null; empty where the table has none.
        /// </summary>
        System.Collections.Generic.IReadOnlyList<PublishedForm> FormsFor(string recordTable);
    }
}
