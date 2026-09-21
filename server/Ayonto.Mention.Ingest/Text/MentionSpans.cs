namespace Ayonto.Mention.Ingest.Text
{
    /// <summary>
    /// Whether a stretch of committed text reads as a whole mention.
    ///
    /// This is the server's copy of the rule the control applies in the browser —
    /// `readsAsMentionSpan` in `pcf/src/domain/mentionText.ts` — and it exists for
    /// one reason: an occurrence position arrives in the companion payload, which
    /// anybody who may write the text may write. A position on its own proves
    /// nothing, so it is held to exactly what the editor itself would have
    /// produced: an "@" that could have opened a mention, at least one character of
    /// a name, an end where a mention may end, and no line break in between.
    ///
    /// What this check is for, and what it is not for, matters more than the check.
    /// It is a structural sanity test on what the editor drew. It is **not**
    /// authorization and never becomes part of identity: a notification is
    /// `eventId` + `recordTable` + `recordId` + `sourceField` + `recipientUserId`,
    /// and a position is not one of the five. Whoever can write the text can write
    /// any position they like, which is exactly why a position may never be a
    /// reason to notify anybody.
    ///
    /// The character sets are written out rather than taken from `\s`, because the
    /// two runtimes do not agree on what that means. JavaScript's `\s` and .NET's
    /// `\s` cover different sets — .NET includes U+0085 and excludes U+FEFF — and a
    /// span the browser considered a mention has to be the span the server
    /// considers a mention. Spelling the set out is how the two stay one rule.
    /// </summary>
    public static class MentionSpans
    {
        /// <summary>
        /// Exactly the characters JavaScript's `\s` matches, which is the set the
        /// control's own rule is written against.
        /// </summary>
        private static bool IsJavaScriptWhitespace(char character)
        {
            // Written as code points rather than as character literals. Several of
            // these are invisible, and a non-breaking space that looks like a space
            // in a source file is a bug nobody can see.
            switch (character)
            {
                case '\t':     // U+0009 tab
                case '\n':     // U+000A line feed
                case '\v':     // U+000B vertical tab
                case '\f':     // U+000C form feed
                case '\r':     // U+000D carriage return
                case ' ':      // U+0020 space
                case (char)0x00A0:  // no-break space
                case (char)0x1680:  // ogham space mark
                case (char)0x2028:  // line separator
                case (char)0x2029:  // paragraph separator
                case (char)0x202F:  // narrow no-break space
                case (char)0x205F:  // medium mathematical space
                case (char)0x3000:  // ideographic space
                case (char)0xFEFF:  // zero width no-break space
                    return true;
                default:
                    // U+2000..U+200A, the en quad through the hair space.
                    return character >= (char)0x2000 && character <= (char)0x200A;
            }
        }

        /// <summary>
        /// Characters that may stand in front of an "@" for it to open a mention:
        /// whitespace or an opening bracket. This is what keeps the "@" of an e-mail
        /// address from reading as a mention of the domain behind it.
        /// </summary>
        private static bool CanPrecedeMention(char character)
        {
            switch (character)
            {
                case '(':
                case '[':
                case '{':
                case '>':
                    return true;
                default:
                    return IsJavaScriptWhitespace(character);
            }
        }

        /// <summary>
        /// Characters a mention may end in front of. Anything else — a letter, a
        /// digit, a hyphen — continues the name, which is what stops a stored span
        /// for "@Alex Rivera" from drawing the first twelve characters of
        /// "@Alex RiveraX" as a person.
        /// </summary>
        private static bool CanFollowMention(char character)
        {
            switch (character)
            {
                case ',':
                case '.':
                case ';':
                case ':':
                case '!':
                case '?':
                case '(':
                case ')':
                case '[':
                case ']':
                case '{':
                case '}':
                case '"':
                    return true;
                default:
                    return IsJavaScriptWhitespace(character);
            }
        }

        /// <summary>
        /// True when the text from <paramref name="start"/> for
        /// <paramref name="length"/> characters reads as one whole mention.
        /// </summary>
        /// <param name="text">The committed text, from the entity image.</param>
        /// <param name="start">Zero-based UTF-16 index of the "@".</param>
        /// <param name="length">How many characters the "@" and the name cover.</param>
        public static bool ReadsAsMention(string text, int start, int length)
        {
            if (text == null)
            {
                return false;
            }
            if (start < 0 || length < 0)
            {
                return false;
            }

            // A mention is an "@" and at least one character of a name, so a span
            // covering one character or none is not one. Written as the control
            // writes it: end must be past start + 1.
            long end = (long)start + length;
            if (end <= (long)start + 1 || end > text.Length)
            {
                return false;
            }

            if (text[start] != '@')
            {
                return false;
            }
            if (start > 0 && !CanPrecedeMention(text[start - 1]))
            {
                return false;
            }

            int to = (int)end;
            if (to < text.Length && !CanFollowMention(text[to]))
            {
                return false;
            }

            // A mention is never written across a line break.
            for (int at = start; at < to; at++)
            {
                if (text[at] == '\r' || text[at] == '\n')
                {
                    return false;
                }
            }

            return true;
        }
    }
}
