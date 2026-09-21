using System.Globalization;

namespace Ayonto.Mention.Ingest
{
    /// <summary>
    /// What one invocation did, counted.
    ///
    /// Returned rather than only traced, so that the rules can be asserted rather than
    /// read out of a log: a replay is not a create, a conflict is not a skip, and a
    /// field whose configuration failed closed is a different thing from a field whose
    /// metadata had not changed.
    /// </summary>
    public sealed class IngestOutcome
    {
        /// <summary>Event rows created.</summary>
        public int Created { get; internal set; }

        /// <summary>Claims that were already recorded with exactly this identity.</summary>
        public int Replayed { get; internal set; }

        /// <summary>
        /// Claims refused because their event identifier already names a different
        /// notification. Nothing is overwritten and no second event is created.
        /// </summary>
        public int Conflicted { get; internal set; }

        /// <summary>
        /// Claims passed over because the recipient could not be resolved to an
        /// enabled user.
        /// </summary>
        public int RecipientsRefused { get; internal set; }

        /// <summary>Fields whose companion payload was read and acted on.</summary>
        public int FieldsProcessed { get; internal set; }

        /// <summary>
        /// Fields whose companion metadata is byte-identical before and after, which is
        /// what a filtering attribute cannot tell the handler for itself.
        /// </summary>
        public int FieldsUnchanged { get; internal set; }

        /// <summary>
        /// Fields where nothing was created because something could not be established:
        /// a payload that is not this control's, no configuration, or configurations
        /// that disagree.
        /// </summary>
        public int FieldsRefused { get; internal set; }

        public override string ToString()
        {
            return string.Format(
                CultureInfo.InvariantCulture,
                "created {0}, replayed {1}, conflicted {2}, recipients refused {3}, "
                + "fields processed {4}, unchanged {5}, refused {6}",
                Created,
                Replayed,
                Conflicted,
                RecipientsRefused,
                FieldsProcessed,
                FieldsUnchanged,
                FieldsRefused);
        }
    }
}
