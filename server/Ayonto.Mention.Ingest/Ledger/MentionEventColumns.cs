namespace Ayonto.Mention.Ingest.Ledger
{
    /// <summary>
    /// The one table this ingest writes, and the columns it writes there.
    ///
    /// **`ayonto_mentionevent` is the ledger, and `ayonto_mention` is not.** The
    /// second table is in the same solution and shares most of its purpose, which is
    /// exactly why it is named here: it came from the legacy product, it is
    /// user-owned, its columns carry a recipient's name and address, and the browser
    /// used to write it directly. None of that is the product this code belongs to.
    /// Writing there would put notification state back in a table whose trust model
    /// this ingest exists to replace.
    ///
    /// The identifiers are text because Dataverse has no custom Unique Identifier
    /// column, and the widths are the contract: 36 characters, canonical, hyphenated,
    /// lower case. See `docs/server-architecture.md`.
    /// </summary>
    public static class MentionEventColumns
    {
        /// <summary>The event ledger's logical name. The only table this ingest writes.</summary>
        public const string TableLogicalName = "ayonto_mentionevent";

        /// <summary>
        /// The legacy table, named so that a test can assert this ingest never writes
        /// it. Nothing here ever uses it as a target.
        /// </summary>
        public const string LegacyTableLogicalName = "ayonto_mention";

        public const string Name = "ayonto_name";
        public const string EventId = "ayonto_eventid";
        public const string RecordTable = "ayonto_recordtable";
        public const string RecordId = "ayonto_recordid";
        public const string SourceField = "ayonto_sourcefield";
        public const string RecipientUserId = "ayonto_recipientuserid";
        public const string InitiatingUserId = "ayonto_initiatinguserid";
        public const string ConfigSchemaVersion = "ayonto_configschemaversion";

        public const string EmailEnabled = "ayonto_emailenabled";
        public const string EmailSubject = "ayonto_emailsubject";
        public const string EmailBody = "ayonto_emailbody";
        public const string EmailLinkText = "ayonto_emaillinktext";

        public const string TeamsEnabled = "ayonto_teamsenabled";
        public const string TeamsTitle = "ayonto_teamstitle";
        public const string TeamsBody = "ayonto_teamsbody";
        public const string TeamsLinkText = "ayonto_teamslinktext";

        public const string InAppEnabled = "ayonto_inappenabled";
        public const string InAppTitle = "ayonto_inapptitle";
        public const string InAppBody = "ayonto_inappbody";
        public const string InAppLinkText = "ayonto_inapplinktext";

        /// <summary>How wide `ayonto_Name` is. A label, and it has to fit.</summary>
        public const int NameLength = 200;
    }
}
