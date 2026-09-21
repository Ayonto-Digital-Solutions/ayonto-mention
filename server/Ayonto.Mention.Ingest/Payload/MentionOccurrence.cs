namespace Ayonto.Mention.Ingest.Payload
{
    /// <summary>
    /// Where one mention stands in the committed text.
    ///
    /// Editor state, and nothing more. It exists so a saved record can be reopened
    /// and read as people rather than characters. It is not identity, not
    /// permission, and no part of what makes a notification the notification it is.
    /// </summary>
    public sealed class MentionOccurrence
    {
        public MentionOccurrence(int start, int length)
        {
            Start = start;
            Length = length;
        }

        /// <summary>Zero-based UTF-16 index of the "@".</summary>
        public int Start { get; }

        /// <summary>How many characters the "@" and the display name cover.</summary>
        public int Length { get; }
    }
}
