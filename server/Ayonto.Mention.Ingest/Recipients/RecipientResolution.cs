namespace Ayonto.Mention.Ingest.Recipients
{
    /// <summary>What the claimed recipient turned out to be.</summary>
    public enum RecipientStatus
    {
        /// <summary>A real user who can be notified.</summary>
        Active,

        /// <summary>No such user, or none this ingest can resolve.</summary>
        Unknown,

        /// <summary>
        /// A real user who is disabled. No new notification event is created for them:
        /// a disabled user is somebody who has left or been switched off, and telling
        /// them is at best pointless.
        /// </summary>
        Disabled,

        /// <summary>
        /// A real, enabled account that is not a person to notify: an application user,
        /// or one of the access modes that exist to run code rather than to read a
        /// message.
        ///
        /// Told apart from <see cref="Unknown"/> on purpose. Both refuse, and an
        /// administrator reading a trace needs to know whether an identifier named
        /// nobody or named something that is not a colleague.
        /// </summary>
        Ineligible,
    }

    /// <summary>The outcome of resolving one claimed recipient.</summary>
    public sealed class RecipientResolution
    {
        private RecipientResolution(RecipientStatus status)
        {
            Status = status;
        }

        public RecipientStatus Status { get; }

        public static RecipientResolution Active()
        {
            return new RecipientResolution(RecipientStatus.Active);
        }

        public static RecipientResolution Unknown()
        {
            return new RecipientResolution(RecipientStatus.Unknown);
        }

        public static RecipientResolution Disabled()
        {
            return new RecipientResolution(RecipientStatus.Disabled);
        }

        public static RecipientResolution Ineligible()
        {
            return new RecipientResolution(RecipientStatus.Ineligible);
        }
    }

    /// <summary>
    /// Where a claimed recipient is checked against the people who may actually be
    /// notified.
    ///
    /// The identifier in the companion payload is a claim like everything else in it,
    /// and it is the one claim that decides who hears about a record. It is resolved
    /// against `systemuser` before anything is written about the person it names, and
    /// it is resolved by identifier only: not by display name, not by e-mail address,
    /// and not by the text an occurrence points at. A name is not an identity wherever
    /// it came from, and two colleagues can share one.
    ///
    /// **Resolution is also where authorization happens**, which is why this is the one
    /// part of the ingest that does not run as SYSTEM. Anybody who may write the source
    /// text may write any identifier into the companion column, so "is this a real
    /// enabled user" is not the whole question — "may the person who saved this record
    /// see that user at all" is the rest of it. Answering that means asking in their
    /// context rather than in the platform's.
    /// </summary>
    public interface IRecipientDirectory
    {
        RecipientResolution Resolve(System.Guid userId);
    }
}
