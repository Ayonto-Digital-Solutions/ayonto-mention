namespace Ayonto.Mention.Ingest.Configuration
{
    /// <summary>
    /// What a Dataverse column's logical name may look like.
    ///
    /// Checked rather than assumed, because these names come out of a step's
    /// unsecure configuration — text somebody typed into a registration — and they
    /// are used to read attributes out of an entity image and to fill the ledger's
    /// `ayonto_SourceField`. A value that is not a logical name is a registration
    /// mistake, and a registration mistake should be loud at the top of the handler
    /// rather than a lookup that quietly finds nothing.
    /// </summary>
    internal static class LogicalNames
    {
        /// <summary>
        /// The ledger's `ayonto_SourceField` and `ayonto_RecordTable` columns hold
        /// 128 characters, which is the widest name this product can record.
        /// </summary>
        internal const int MaximumLength = 128;

        /// <summary>
        /// True for a lower-case logical name: a letter first, then letters, digits
        /// or underscores. Logical names in Dataverse are lower case, which is why
        /// the configuration parser lowers what it is given before asking.
        /// </summary>
        internal static bool IsWellFormed(string name)
        {
            if (string.IsNullOrEmpty(name) || name.Length > MaximumLength)
            {
                return false;
            }

            char first = name[0];
            if (first < 'a' || first > 'z')
            {
                return false;
            }

            for (int at = 1; at < name.Length; at++)
            {
                char character = name[at];
                bool allowed = (character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')
                    || character == '_';
                if (!allowed)
                {
                    return false;
                }
            }

            return true;
        }
    }
}
