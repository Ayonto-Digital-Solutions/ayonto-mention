using System;

namespace Ayonto.Mention.Ingest.Identity
{
    /// <summary>
    /// The one spelling of an identifier this product compares on.
    ///
    /// The ledger stores identifiers as text, because Dataverse has no custom
    /// Unique Identifier column to store them in, and the columns are 36 characters
    /// wide: canonical, hyphenated, lower case, and nothing else fits. That is not a
    /// formatting preference. Identity here is five values compared as strings, so
    /// two spellings of one GUID would be two recipients, two events, or an event
    /// that never matches the replay it is.
    ///
    /// Everything crossing into this product is normalized here — values from the
    /// untrusted payload and values from the trusted execution context alike. The
    /// trust question is separate and answered elsewhere; the spelling question is
    /// answered once, here.
    /// </summary>
    public static class Identifiers
    {
        /// <summary>How wide a canonical identifier is, and how wide the columns are.</summary>
        public const int CanonicalLength = 36;

        /// <summary>
        /// Normalizes an identifier that arrived as text, or refuses it.
        ///
        /// The empty GUID is refused along with everything unparseable. It parses,
        /// and it names nobody: a recipient of all zeros is not a user who happens
        /// to have that id, it is a value somebody left unset.
        /// </summary>
        public static bool TryNormalize(string raw, out string normalized)
        {
            normalized = null;
            if (string.IsNullOrWhiteSpace(raw))
            {
                return false;
            }

            Guid parsed;
            if (!Guid.TryParse(raw.Trim(), out parsed) || parsed == Guid.Empty)
            {
                return false;
            }

            normalized = Normalize(parsed);
            return true;
        }

        /// <summary>
        /// Normalizes an identifier that came from the platform as a GUID already.
        ///
        /// Guid.ToString("D") is the canonical hyphenated form, and .NET writes its
        /// hexadecimal in lower case — the lowering is belt and braces, so that the
        /// contract holds because it is stated rather than because a framework
        /// happens to agree with it.
        /// </summary>
        public static string Normalize(Guid value)
        {
            return value.ToString("D").ToLowerInvariant();
        }

        /// <summary>
        /// The parsed value behind a normalized identifier, for the places that need
        /// a GUID rather than its spelling — a Dataverse query, an entity reference.
        /// </summary>
        public static bool TryParse(string raw, out Guid value)
        {
            value = Guid.Empty;
            if (string.IsNullOrWhiteSpace(raw))
            {
                return false;
            }

            Guid parsed;
            if (!Guid.TryParse(raw.Trim(), out parsed) || parsed == Guid.Empty)
            {
                return false;
            }

            value = parsed;
            return true;
        }
    }
}
