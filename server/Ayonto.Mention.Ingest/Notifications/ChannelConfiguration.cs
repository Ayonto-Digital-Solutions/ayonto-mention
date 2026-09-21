using System;

namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>
    /// One channel's notification configuration, as a published form declared it.
    ///
    /// Frozen onto the event row when the event is created. A maker who edits and
    /// republishes a form must not thereby change how an event that already exists
    /// is delivered: without the snapshot an event waiting in a queue would go out
    /// under whatever happened to be published when the dispatcher reached it, and a
    /// retry could differ from the attempt it was retrying.
    /// </summary>
    public sealed class ChannelConfiguration
    {
        public ChannelConfiguration(bool enabled, string title, string body, string linkText)
        {
            Enabled = enabled;
            Title = title;
            Body = body;
            LinkText = linkText;
        }

        /// <summary>A channel nobody configured, which is the manifest's default.</summary>
        public static ChannelConfiguration Off
        {
            get { return new ChannelConfiguration(false, null, null, null); }
        }

        public bool Enabled { get; }

        /// <summary>Subject for e-mail, title for Teams and in-app. Null where unset.</summary>
        public string Title { get; }

        public string Body { get; }

        public string LinkText { get; }

        /// <summary>
        /// Two channel configurations are the same configuration when every value is.
        /// Compared ordinally, and with unset and empty already normalized to null by
        /// the reader, so that "no subject" and "an empty subject" cannot look like a
        /// disagreement between two published forms.
        /// </summary>
        public bool Matches(ChannelConfiguration other)
        {
            return other != null
                && Enabled == other.Enabled
                && string.Equals(Title, other.Title, StringComparison.Ordinal)
                && string.Equals(Body, other.Body, StringComparison.Ordinal)
                && string.Equals(LinkText, other.LinkText, StringComparison.Ordinal);
        }
    }
}
