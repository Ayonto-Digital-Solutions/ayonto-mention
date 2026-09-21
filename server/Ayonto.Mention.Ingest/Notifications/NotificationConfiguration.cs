namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>
    /// The notification configuration of one mention-enabled field: the three
    /// channels and the content each needs.
    ///
    /// Resolved from **published** form metadata, per record table and source field,
    /// and never from the payload. A value a maker typed into a form configuration
    /// reaches the server the way everything else from a client reaches it — as a
    /// claim — and the reasoning that keeps a client-supplied recipient from deciding
    /// who gets a message applies just as well to a client-supplied subject line and
    /// above all to a client-supplied "Teams is on".
    /// </summary>
    public sealed class NotificationConfiguration
    {
        /// <summary>
        /// The shape this snapshot is written in, recorded on the row as
        /// `ayonto_ConfigSchemaVersion` so a later channel can be added without
        /// guessing at the old rows.
        /// </summary>
        public const int SchemaVersion = 1;

        public NotificationConfiguration(
            ChannelConfiguration email,
            ChannelConfiguration teams,
            ChannelConfiguration inApp)
        {
            Email = email;
            Teams = teams;
            InApp = inApp;
        }

        public ChannelConfiguration Email { get; }

        public ChannelConfiguration Teams { get; }

        public ChannelConfiguration InApp { get; }

        /// <summary>Every channel off, which is what an unconfigured control means.</summary>
        public static NotificationConfiguration Silent
        {
            get
            {
                return new NotificationConfiguration(
                    ChannelConfiguration.Off,
                    ChannelConfiguration.Off,
                    ChannelConfiguration.Off);
            }
        }

        public bool Matches(NotificationConfiguration other)
        {
            return other != null
                && Email.Matches(other.Email)
                && Teams.Matches(other.Teams)
                && InApp.Matches(other.InApp);
        }
    }
}
