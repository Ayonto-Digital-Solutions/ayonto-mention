using System;
using System.Collections.Generic;

namespace Ayonto.Mention.Ingest
{
    /// <summary>
    /// One saved record, as the ingest needs to see it — and deliberately not as an
    /// `Entity`.
    ///
    /// Everything here has already been taken from the trusted half of the execution
    /// context or from an entity image, and normalized. The table, the record id and
    /// the initiating user are the platform's answers rather than the payload's: a
    /// payload naming its own table or its own actor would be a payload deciding what
    /// it is allowed to be.
    ///
    /// The images arrive as plain maps of column to committed value. That is what lets
    /// the whole ingest be exercised without a Dataverse, and it keeps the orchestration
    /// from growing an opinion about how an image is shaped.
    /// </summary>
    public sealed class IngestRequest
    {
        public IngestRequest(
            string messageName,
            string recordTable,
            string recordId,
            string initiatingUserId,
            IReadOnlyDictionary<string, string> postImage,
            IReadOnlyDictionary<string, string> preImage)
        {
            MessageName = messageName;
            RecordTable = recordTable;
            RecordId = recordId;
            InitiatingUserId = initiatingUserId;
            PostImage = postImage;
            PreImage = preImage;
        }

        /// <summary>`Create` or `Update`. Nothing else reaches this far.</summary>
        public string MessageName { get; }

        /// <summary>From `IPluginExecutionContext.PrimaryEntityName`, lower case.</summary>
        public string RecordTable { get; }

        /// <summary>From `IPluginExecutionContext.PrimaryEntityId`, normalized.</summary>
        public string RecordId { get; }

        /// <summary>
        /// From `IPluginExecutionContext.InitiatingUserId`: the trusted identity of
        /// whoever caused the source-record operation, and the actor the event records.
        /// </summary>
        public string InitiatingUserId { get; }

        /// <summary>
        /// The committed state of the source text and companion columns. A column with
        /// no value is simply absent — that is how Dataverse images work, and an empty
        /// memo column is the ordinary case here rather than a defect.
        /// </summary>
        public IReadOnlyDictionary<string, string> PostImage { get; }

        /// <summary>
        /// The companion columns as they were before an `Update`, for the before/after
        /// comparison. Null on `Create`, where there is nothing before.
        /// </summary>
        public IReadOnlyDictionary<string, string> PreImage { get; }

        /// <summary>True for the `Update` message, which is the one that has a pre image.</summary>
        public bool IsUpdate
        {
            get { return string.Equals(MessageName, "Update", StringComparison.Ordinal); }
        }

        /// <summary>
        /// The committed value of one column, or null. Absent and empty are the same
        /// answer, because an image does not distinguish them.
        /// </summary>
        public static string Value(IReadOnlyDictionary<string, string> image, string column)
        {
            string value;
            if (image == null || !image.TryGetValue(column, out value))
            {
                return null;
            }

            return string.IsNullOrWhiteSpace(value) ? null : value;
        }
    }
}
