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
    }

    /// <summary>
    /// Where a claimed recipient is checked against the people who actually exist.
    ///
    /// The identifier in the companion payload is a claim like everything else in it.
    /// It is resolved against `systemuser` before anything is written about the person
    /// it names, and it is resolved by identifier only: not by display name, not by
    /// e-mail address, and not by the text an occurrence points at. A name is not an
    /// identity wherever it came from, and two colleagues can share one.
    /// </summary>
    public interface IRecipientDirectory
    {
        RecipientResolution Resolve(System.Guid userId);
    }
}
