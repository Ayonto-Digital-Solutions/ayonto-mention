namespace Ayonto.Mention.Ingest
{
    /// <summary>
    /// The registration this plug-in expects, written down where the code can check it.
    ///
    /// A step is the registration — the message, the table, the stage, the mode, the
    /// filters and the handler, in one component — and none of it is inside this
    /// assembly. The host solution registers it against its own tables. So the handler
    /// states here what it was written for and refuses to guess when it finds itself
    /// somewhere else.
    ///
    /// The full registration, including filtering attributes and the images, is in
    /// `docs/server-architecture.md`.
    /// </summary>
    public static class PluginRegistration
    {
        /// <summary>The two messages this handler is written for.</summary>
        public const string CreateMessage = "Create";

        public const string UpdateMessage = "Update";

        /// <summary>
        /// PostOperation. The record is written by the time the handler runs, which is
        /// what makes a post image and a committed text meaningful.
        /// </summary>
        public const int PostOperationStage = 40;

        /// <summary>
        /// Asynchronous. A synchronous PostOperation step runs "within the database
        /// transaction", and "an exception thrown by your code at any synchronous stage
        /// within the database transaction causes the entire transaction to roll back" —
        /// which would make a notification defect capable of refusing somebody's
        /// business record. Asynchronous steps "run outside of the database transaction
        /// using the asynchronous service", so the record is already saved and durable
        /// when this work begins.
        /// https://learn.microsoft.com/power-apps/developer/data-platform/event-framework
        /// </summary>
        public const int AsynchronousMode = 1;

        /// <summary>
        /// The alias the post image is registered under. It carries the source text
        /// columns and their companion metadata columns, and nothing else: selecting all
        /// columns is explicitly warned against.
        /// </summary>
        public const string PostImageAlias = "PostImage";

        /// <summary>
        /// The alias the `Update` pre image is registered under. It carries the companion
        /// metadata columns, which is what the before/after comparison needs. `Create`
        /// has none, because there is nothing before a record exists.
        /// </summary>
        public const string PreImageAlias = "PreImage";
    }
}
