namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>What resolving a field's notification configuration came to.</summary>
    public enum NotificationConfigurationStatus
    {
        /// <summary>Exactly one configuration, however many forms agreed on it.</summary>
        Resolved,

        /// <summary>
        /// No published Mention control instance for this table and column. Nothing is
        /// known about how a notification for it should look, so no event is created.
        /// </summary>
        NotConfigured,

        /// <summary>
        /// Published instances disagree. Refused rather than resolved: choosing
        /// arbitrarily among conflicting configurations produces a message whose
        /// channels and wording depend on which row a query happened to return first —
        /// a defect that stays invisible until it sends the wrong text to exactly the
        /// right person.
        /// </summary>
        Conflicting,

        /// <summary>
        /// A configuration that cannot be read or cannot be honoured — an unreadable
        /// boolean, a channel switched on with nothing to say, a value longer than the
        /// column that has to hold it.
        /// </summary>
        Invalid,
    }

    /// <summary>The outcome of resolving one field's notification configuration.</summary>
    public sealed class NotificationConfigurationResult
    {
        private NotificationConfigurationResult(
            NotificationConfigurationStatus status,
            NotificationConfiguration configuration,
            string problem)
        {
            Status = status;
            Configuration = configuration;
            Problem = problem;
        }

        public NotificationConfigurationStatus Status { get; }

        /// <summary>Present only when <see cref="Status"/> is Resolved.</summary>
        public NotificationConfiguration Configuration { get; }

        /// <summary>A short, non-sensitive description of what was wrong.</summary>
        public string Problem { get; }

        public static NotificationConfigurationResult Resolved(NotificationConfiguration configuration)
        {
            return new NotificationConfigurationResult(NotificationConfigurationStatus.Resolved, configuration, null);
        }

        public static NotificationConfigurationResult NotConfigured(string problem)
        {
            return new NotificationConfigurationResult(NotificationConfigurationStatus.NotConfigured, null, problem);
        }

        public static NotificationConfigurationResult Conflicting(string problem)
        {
            return new NotificationConfigurationResult(NotificationConfigurationStatus.Conflicting, null, problem);
        }

        public static NotificationConfigurationResult Invalid(string problem)
        {
            return new NotificationConfigurationResult(NotificationConfigurationStatus.Invalid, null, problem);
        }
    }

    /// <summary>
    /// Where a field's authoritative notification configuration comes from.
    ///
    /// Resolution happens once, in the ingest. The dispatcher does not read form
    /// metadata, does not resolve configuration and does not need to know that forms
    /// exist; it reads the event row it was handed. That is what keeps a single
    /// dispatcher able to serve every host.
    /// </summary>
    public interface INotificationConfigurationResolver
    {
        NotificationConfigurationResult Resolve(string recordTable, string sourceField);
    }
}
