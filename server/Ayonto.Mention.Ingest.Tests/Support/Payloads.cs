using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Ayonto.Mention.Ingest.Tests.Support
{
    /// <summary>
    /// Builds companion payloads the way the control writes them.
    ///
    /// Deliberately a string builder rather than a serializer: these tests are about
    /// what the ingest does with a string in a column, and a test that could only
    /// produce well-formed input would not be testing the half that matters.
    /// </summary>
    public static class Payloads
    {
        /// <summary>One claim: an episode, a recipient, and where they stand in the text.</summary>
        public sealed class Claim
        {
            public Claim(string eventId, string recipientUserId, params int[] startsAndLengths)
            {
                EventId = eventId;
                RecipientUserId = recipientUserId;
                Spans = startsAndLengths;
            }

            public string EventId { get; }

            public string RecipientUserId { get; }

            /// <summary>Start, length, start, length — in pairs.</summary>
            public int[] Spans { get; }
        }

        public static Claim Mention(string eventId, string recipientUserId, params int[] startsAndLengths)
        {
            return new Claim(eventId, recipientUserId, startsAndLengths);
        }

        /// <summary>A payload with the supported schema version.</summary>
        public static string Metadata(string sourceField, params Claim[] claims)
        {
            return Metadata(1, sourceField, claims);
        }

        /// <summary>A payload claiming any schema version, for the tests about versions.</summary>
        public static string Metadata(int schemaVersion, string sourceField, params Claim[] claims)
        {
            var built = new StringBuilder();
            built.Append("{\"schemaVersion\":")
                .Append(schemaVersion.ToString(CultureInfo.InvariantCulture))
                .Append(",\"sourceField\":\"")
                .Append(sourceField)
                .Append("\",\"mentions\":[");

            for (int index = 0; index < claims.Length; index++)
            {
                if (index > 0)
                {
                    built.Append(',');
                }

                Claim claim = claims[index];
                built.Append("{\"eventId\":\"").Append(claim.EventId)
                    .Append("\",\"recipientUserId\":\"").Append(claim.RecipientUserId)
                    .Append("\",\"occurrences\":[");
                for (int span = 0; span + 1 < claim.Spans.Length; span += 2)
                {
                    if (span > 0)
                    {
                        built.Append(',');
                    }

                    built.Append("{\"start\":").Append(claim.Spans[span].ToString(CultureInfo.InvariantCulture))
                        .Append(",\"length\":").Append(claim.Spans[span + 1].ToString(CultureInfo.InvariantCulture))
                        .Append('}');
                }

                built.Append("]}");
            }

            return built.Append("]}").ToString();
        }

        /// <summary>A fresh canonical identifier, the shape the control writes.</summary>
        public static string NewId()
        {
            return Guid.NewGuid().ToString("D").ToLowerInvariant();
        }

        /// <summary>An image, as a map of column to committed value.</summary>
        public static IReadOnlyDictionary<string, string> Image(params string[] columnsAndValues)
        {
            var image = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int at = 0; at + 1 < columnsAndValues.Length; at += 2)
            {
                image[columnsAndValues[at]] = columnsAndValues[at + 1];
            }

            return image;
        }
    }
}
