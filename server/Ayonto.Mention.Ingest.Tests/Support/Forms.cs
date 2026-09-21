using System.Collections.Generic;
using System.Text;

namespace Ayonto.Mention.Ingest.Tests.Support
{
    /// <summary>
    /// Builds the form XML Dataverse stores for a form carrying code components.
    ///
    /// The shape is the documented one: the layout binds a control to a column with
    /// `datafieldname`, and a `controlDescription` with a required `forControl`
    /// attribute carries the `customControl` and its `parameters`.
    /// https://learn.microsoft.com/power-apps/developer/model-driven-apps/form-xml-schema
    /// </summary>
    public static class Forms
    {
        /// <summary>The component this product is.</summary>
        public const string MentionControl = "Ayonto.AyontoMentionControl";

        /// <summary>The productive legacy control, which is a different component.</summary>
        public const string LegacyControl = "Ayonto.MentionControl";

        /// <summary>Every notification setting switched on, with content for each channel.</summary>
        public static Dictionary<string, string> AllChannelsOn()
        {
            return new Dictionary<string, string>
            {
                { "emailEnabled", "true" },
                { "emailSubject", "You were mentioned" },
                { "emailBody", "Somebody mentioned you." },
                { "emailLinkText", "Open the record" },
                { "teamsEnabled", "true" },
                { "teamsTitle", "Mentioned" },
                { "teamsBody", "Somebody mentioned you." },
                { "teamsLinkText", "Open" },
                { "inAppEnabled", "true" },
                { "inAppTitle", "Mentioned" },
                { "inAppBody", "Somebody mentioned you." },
                { "inAppLinkText", "Show me" },
            };
        }

        /// <summary>E-mail on with a subject and a message, the other two channels off.</summary>
        public static Dictionary<string, string> EmailOnly()
        {
            return new Dictionary<string, string>
            {
                { "emailEnabled", "true" },
                { "emailSubject", "You were mentioned" },
                { "emailBody", "Somebody mentioned you." },
            };
        }

        /// <summary>A form whose Mention control is bound to one column and configured.</summary>
        public static string With(string column, IReadOnlyDictionary<string, string> settings)
        {
            return With(MentionControl, column, column, settings, bindThroughDataFieldName: false, staticValues: true);
        }

        /// <summary>
        /// A form built to order.
        /// </summary>
        /// <param name="controlName">Which code component the instance is.</param>
        /// <param name="boundColumn">The column the layout binds the control to.</param>
        /// <param name="fieldParameter">
        /// What the control's own `field` parameter names, or null to leave it out so the
        /// layout binding is the only answer.
        /// </param>
        /// <param name="settings">The notification parameters.</param>
        /// <param name="bindThroughDataFieldName">Leave the `field` parameter out.</param>
        /// <param name="staticValues">Whether the parameters are marked as literals.</param>
        public static string With(
            string controlName,
            string boundColumn,
            string fieldParameter,
            IReadOnlyDictionary<string, string> settings,
            bool bindThroughDataFieldName,
            bool staticValues)
        {
            var built = new StringBuilder();
            built.Append("<form><tabs><tab><columns><column><sections><section><rows><row><cell>")
                .Append("<control id=\"").Append(boundColumn)
                .Append("\" classid=\"{270BD3DB-D9AF-4782-9025-509E298DEC0A}\" datafieldname=\"")
                .Append(boundColumn)
                .Append("\" />")
                .Append("</cell></row></rows></section></sections></column></columns></tab></tabs>")
                .Append("<controlDescriptions><controlDescription forControl=\"")
                .Append(boundColumn)
                .Append("\"><customControl id=\"{f2b1c7de-2b6a-4f5a-9a43-9c8a6d0f1e11}\" name=\"")
                .Append(controlName)
                .Append("\" formFactor=\"0\"><parameters>");

            if (!bindThroughDataFieldName && fieldParameter != null)
            {
                built.Append("<field>").Append(fieldParameter).Append("</field>");
            }

            if (settings != null)
            {
                foreach (KeyValuePair<string, string> setting in settings)
                {
                    built.Append('<').Append(setting.Key);
                    if (staticValues)
                    {
                        built.Append(" static=\"true\"");
                    }
                    else
                    {
                        built.Append(" static=\"false\"");
                    }

                    built.Append('>').Append(setting.Value).Append("</").Append(setting.Key).Append('>');
                }
            }

            return built.Append("</parameters></customControl></controlDescription></controlDescriptions></form>")
                .ToString();
        }
    }
}
