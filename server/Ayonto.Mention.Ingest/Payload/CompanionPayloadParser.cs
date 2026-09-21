using System;
using System.Collections.Generic;
using System.Globalization;
using Ayonto.Mention.Ingest.Identity;
using Ayonto.Mention.Ingest.Json;
using Ayonto.Mention.Ingest.Text;

namespace Ayonto.Mention.Ingest.Payload
{
    /// <summary>What reading a companion column came to.</summary>
    public enum CompanionPayloadStatus
    {
        /// <summary>The column holds nothing. An ordinary record with no mentions.</summary>
        Absent,

        /// <summary>A payload this product wrote, and every claim in it is well formed.</summary>
        Valid,

        /// <summary>Something this product did not write, or could not have written.</summary>
        Invalid,
    }

    /// <summary>The outcome of reading one companion column.</summary>
    public sealed class CompanionPayloadResult
    {
        private CompanionPayloadResult(CompanionPayloadStatus status, CompanionPayload payload, string problem)
        {
            Status = status;
            Payload = payload;
            Problem = problem;
        }

        public CompanionPayloadStatus Status { get; }

        /// <summary>The payload, present only when <see cref="Status"/> is Valid.</summary>
        public CompanionPayload Payload { get; }

        /// <summary>A short, non-sensitive description of why a payload was refused.</summary>
        public string Problem { get; }

        internal static CompanionPayloadResult Absent()
        {
            return new CompanionPayloadResult(CompanionPayloadStatus.Absent, null, null);
        }

        internal static CompanionPayloadResult Valid(CompanionPayload payload)
        {
            return new CompanionPayloadResult(CompanionPayloadStatus.Valid, payload, null);
        }

        internal static CompanionPayloadResult Invalid(string problem)
        {
            return new CompanionPayloadResult(CompanionPayloadStatus.Invalid, null, problem);
        }
    }

    /// <summary>
    /// Reads the companion payload the control writes, and refuses everything else.
    ///
    /// The wire format is the one `pcf/src/domain/mentionMetadata.ts` serializes:
    ///
    /// <code>
    /// {"schemaVersion":1,"sourceField":"description","mentions":[
    ///   {"eventId":"...","recipientUserId":"...","occurrences":[{"start":0,"length":12}]}]}
    /// </code>
    ///
    /// Every value in it is a claim, and the validation here is in two levels,
    /// because two different things can be wrong.
    ///
    /// **The shape can be wrong**, and then the whole payload is refused: an unknown
    /// `schemaVersion`, a `sourceField` that is not the column the host's own step
    /// mapped, a member of the wrong kind, an identifier that is not a GUID, one
    /// recipient claimed twice, occurrence spans that overlap. None of that is a
    /// record somebody edited; it is a payload this control did not write, and a
    /// payload this control did not write is not a payload to take pieces out of.
    ///
    /// **Or the committed text can simply not carry a mention any more**, and then
    /// that one claim is dropped and the rest of the payload stands. A record can be
    /// edited by something that never saw this control, and a span left pointing at
    /// text that has moved on is the ordinary consequence. A claim with no place left
    /// in the text names nobody the text names, so no event is created for it.
    ///
    /// What is never done here: a display name is never matched against anything, and
    /// an occurrence never authorizes anything. Positions are read to understand what
    /// the editor drew, because whoever can write the text can write any position.
    ///
    /// Pure: no Dataverse, no platform, nothing but the strings it is handed.
    /// </summary>
    public static class CompanionPayloadParser
    {
        /// <summary>
        /// The one payload shape this product understands. An unknown version is
        /// refused rather than guessed at: a payload from a version that does not
        /// exist yet is a payload whose meaning is not known here.
        /// </summary>
        public const int SupportedSchemaVersion = 1;

        /// <summary>
        /// Reads one companion column.
        /// </summary>
        /// <param name="raw">The committed companion value, from the post image.</param>
        /// <param name="expectedSourceField">
        /// The source column the host's step mapped this companion column to. The
        /// payload's own `sourceField` is accepted only where it matches this.
        /// </param>
        /// <param name="committedText">
        /// The committed text of that source column, from the same post image, which
        /// is what occurrence spans are held against.
        /// </param>
        public static CompanionPayloadResult Read(string raw, string expectedSourceField, string committedText)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return CompanionPayloadResult.Absent();
            }

            JsonValue document;
            string problem;
            if (!JsonReader.TryRead(raw, out document, out problem))
            {
                return CompanionPayloadResult.Invalid("not JSON: " + problem);
            }
            if (document.Kind != JsonKind.Object)
            {
                return CompanionPayloadResult.Invalid("the payload is not an object");
            }

            int schemaVersion;
            JsonValue version = document.Member("schemaVersion");
            if (version == null || !version.TryReadInt32(out schemaVersion))
            {
                return CompanionPayloadResult.Invalid("no readable schemaVersion");
            }
            if (schemaVersion != SupportedSchemaVersion)
            {
                return CompanionPayloadResult.Invalid(
                    "schemaVersion " + schemaVersion.ToString(CultureInfo.InvariantCulture)
                    + " is not supported by this ingest");
            }

            string sourceField;
            JsonValue field = document.Member("sourceField");
            if (field == null || !field.TryReadString(out sourceField))
            {
                return CompanionPayloadResult.Invalid("no readable sourceField");
            }
            if (!string.Equals(sourceField.Trim().ToLowerInvariant(), expectedSourceField, StringComparison.Ordinal))
            {
                // The payload belongs to one column, and which column that is comes
                // from the step's mapping rather than from the payload's assertion.
                // Taken on another column it describes positions in text it has
                // never seen.
                return CompanionPayloadResult.Invalid("the payload names a source column this step did not map to it");
            }

            JsonValue mentions = document.Member("mentions");
            if (mentions == null || mentions.Kind != JsonKind.Array)
            {
                return CompanionPayloadResult.Invalid("mentions is not an array");
            }

            var claims = new List<MentionClaim>();
            var recipients = new HashSet<string>(StringComparer.Ordinal);
            // One position speaks for one person. Two claims reaching for the same
            // stretch of text cannot both be right, and nothing here can tell which
            // of them is.
            var taken = new List<MentionOccurrence>();

            foreach (JsonValue entry in mentions.Items)
            {
                if (entry.Kind != JsonKind.Object)
                {
                    return CompanionPayloadResult.Invalid("a mention is not an object");
                }

                string eventId;
                JsonValue rawEventId = entry.Member("eventId");
                string eventIdText;
                if (rawEventId == null || !rawEventId.TryReadString(out eventIdText)
                    || !Identifiers.TryNormalize(eventIdText, out eventId))
                {
                    return CompanionPayloadResult.Invalid("a mention has no readable eventId");
                }

                string recipientUserId;
                JsonValue rawRecipient = entry.Member("recipientUserId");
                string recipientText;
                if (rawRecipient == null || !rawRecipient.TryReadString(out recipientText)
                    || !Identifiers.TryNormalize(recipientText, out recipientUserId))
                {
                    return CompanionPayloadResult.Invalid("a mention has no readable recipientUserId");
                }
                if (!recipients.Add(recipientUserId))
                {
                    // One row per recipient per episode is the granularity the whole
                    // product rests on. The same person twice in one payload is two
                    // claims on one episode, and the control does not write that.
                    return CompanionPayloadResult.Invalid("the same recipient is claimed twice");
                }

                JsonValue occurrences = entry.Member("occurrences");
                if (occurrences == null || occurrences.Kind != JsonKind.Array)
                {
                    return CompanionPayloadResult.Invalid("occurrences is not an array");
                }

                var places = new List<MentionOccurrence>();
                foreach (JsonValue candidate in occurrences.Items)
                {
                    if (candidate.Kind != JsonKind.Object)
                    {
                        return CompanionPayloadResult.Invalid("an occurrence is not an object");
                    }

                    int start;
                    int length;
                    JsonValue rawStart = candidate.Member("start");
                    JsonValue rawLength = candidate.Member("length");
                    if (rawStart == null || !rawStart.TryReadInt32(out start)
                        || rawLength == null || !rawLength.TryReadInt32(out length))
                    {
                        return CompanionPayloadResult.Invalid("an occurrence has no readable start and length");
                    }

                    if (!MentionSpans.ReadsAsMention(committedText, start, length))
                    {
                        // The text moved on without this one, or it never described
                        // the text at all. Either way it points at nothing, and it
                        // is not a reason to notify anybody.
                        continue;
                    }

                    var place = new MentionOccurrence(start, length);
                    if (Overlaps(taken, place))
                    {
                        return CompanionPayloadResult.Invalid("two occurrences claim the same text");
                    }
                    taken.Add(place);
                    places.Add(place);
                }

                if (places.Count == 0)
                {
                    // An episode with nothing left to point at is over. Creating an
                    // event would notify somebody about a mention the committed text
                    // does not carry.
                    continue;
                }

                places.Sort((left, right) => left.Start.CompareTo(right.Start));
                claims.Add(new MentionClaim(eventId, recipientUserId, places));
            }

            return CompanionPayloadResult.Valid(new CompanionPayload(expectedSourceField, claims));
        }

        private static bool Overlaps(List<MentionOccurrence> taken, MentionOccurrence candidate)
        {
            int start = candidate.Start;
            int end = candidate.Start + candidate.Length;
            foreach (MentionOccurrence other in taken)
            {
                int otherEnd = other.Start + other.Length;
                if (other.Start < end && start < otherEnd)
                {
                    return true;
                }
            }

            return false;
        }
    }
}
