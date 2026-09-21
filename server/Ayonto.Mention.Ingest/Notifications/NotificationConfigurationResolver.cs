using System;
using System.Collections.Generic;
using System.Globalization;

namespace Ayonto.Mention.Ingest.Notifications
{
    /// <summary>
    /// Resolves the one notification configuration that applies to a table and a
    /// column, out of every published form that carries a Mention control for it.
    ///
    /// The identity is `recordTable + sourceField`, and nothing else. **Not** the
    /// form the user was looking at: no documented member of the plug-in execution
    /// context names one, and asking the client for it would be asking the browser to
    /// name its own authority. So the server asks the question it can answer alone —
    /// which column on which table — and that question has to have exactly one
    /// answer.
    ///
    /// Nothing prevents a maker placing the same field on several published forms,
    /// each with its own control instance, and the identity above admits no tiebreak
    /// between them. So the product rule is that every published Mention control
    /// instance for the same table and column must carry identical settings, and
    /// where they disagree this fails closed: no first match, no most recently
    /// published form, no default form, no union. The unhelpfulness is the point. A
    /// configuration conflict is a customizing error, it belongs to the maker who
    /// made it, and it should be loud rather than survivable.
    /// </summary>
    public sealed class NotificationConfigurationResolver : INotificationConfigurationResolver
    {
        /// <summary>
        /// The widest a single-line setting may be, because that is how wide the
        /// column that has to hold it is: `ayonto_EmailSubject`, the two titles and
        /// the three link texts are 4000 characters.
        /// </summary>
        private const int MaximumSingleLineLength = 4000;

        /// <summary>
        /// The widest a message body may be — `ayonto_EmailBody` and its two siblings
        /// are memo columns of 100000.
        /// </summary>
        private const int MaximumBodyLength = 100000;

        private readonly IPublishedFormSource _forms;

        public NotificationConfigurationResolver(IPublishedFormSource forms)
        {
            if (forms == null)
            {
                throw new ArgumentNullException(nameof(forms));
            }

            _forms = forms;
        }

        public NotificationConfigurationResult Resolve(string recordTable, string sourceField)
        {
            if (string.IsNullOrWhiteSpace(recordTable) || string.IsNullOrWhiteSpace(sourceField))
            {
                return NotificationConfigurationResult.Invalid("no table and column to resolve a configuration for");
            }

            IReadOnlyList<PublishedForm> forms = _forms.FormsFor(recordTable);
            if (forms == null || forms.Count == 0)
            {
                return NotificationConfigurationResult.NotConfigured(
                    "no published form of " + recordTable + " could be read");
            }

            NotificationConfiguration agreed = null;
            string agreedOn = null;
            int instances = 0;

            foreach (PublishedForm form in forms)
            {
                IReadOnlyList<IReadOnlyDictionary<string, MentionControlInstances.ParameterValue>> found;
                string problem;
                if (!MentionControlInstances.TryRead(form.FormXml, sourceField, out found, out problem))
                {
                    // A form whose XML cannot be read might be the form that carries
                    // the configuration, or a disagreeing one. Neither can be ruled
                    // out, so nothing is concluded from the forms that did read.
                    return NotificationConfigurationResult.Invalid(
                        "form " + Describe(form) + ": " + problem);
                }

                foreach (IReadOnlyDictionary<string, MentionControlInstances.ParameterValue> parameters in found)
                {
                    instances++;

                    NotificationConfiguration configuration;
                    if (!TryRead(parameters, out configuration, out problem))
                    {
                        return NotificationConfigurationResult.Invalid(
                            "form " + Describe(form) + ": " + problem);
                    }

                    if (agreed == null)
                    {
                        agreed = configuration;
                        agreedOn = Describe(form);
                        continue;
                    }

                    if (!agreed.Matches(configuration))
                    {
                        return NotificationConfigurationResult.Conflicting(
                            "form " + Describe(form) + " configures " + recordTable + "." + sourceField
                            + " differently from form " + agreedOn
                            + " — every published Mention control instance for one column must agree");
                    }
                }
            }

            if (agreed == null)
            {
                return NotificationConfigurationResult.NotConfigured(
                    "no published Mention control instance configures " + recordTable + "." + sourceField);
            }

            return NotificationConfigurationResult.Resolved(agreed);
        }

        /// <summary>
        /// Turns one instance's parameters into a configuration, or refuses them.
        ///
        /// The required columns on the ledger are `ApplicationRequired`, and that is
        /// as strong as a custom column gets: model-driven apps honour it, the platform
        /// does not enforce it. So the hard contract belongs here, before an event
        /// exists — including the rule the manifest has no way to express, that a
        /// channel switched on needs something to say. Link text stays optional,
        /// because a channel may legitimately not use one.
        /// </summary>
        private static bool TryRead(
            IReadOnlyDictionary<string, MentionControlInstances.ParameterValue> parameters,
            out NotificationConfiguration configuration,
            out string problem)
        {
            configuration = null;

            ChannelConfiguration email;
            ChannelConfiguration teams;
            ChannelConfiguration inApp;
            if (!TryReadChannel(parameters, "email", "emailEnabled", "emailSubject", "emailBody", "emailLinkText", out email, out problem)
                || !TryReadChannel(parameters, "Teams", "teamsEnabled", "teamsTitle", "teamsBody", "teamsLinkText", out teams, out problem)
                || !TryReadChannel(parameters, "in-app", "inAppEnabled", "inAppTitle", "inAppBody", "inAppLinkText", out inApp, out problem))
            {
                return false;
            }

            configuration = new NotificationConfiguration(email, teams, inApp);
            return true;
        }

        private static bool TryReadChannel(
            IReadOnlyDictionary<string, MentionControlInstances.ParameterValue> parameters,
            string channel,
            string enabledParameter,
            string titleParameter,
            string bodyParameter,
            string linkTextParameter,
            out ChannelConfiguration channelConfiguration,
            out string problem)
        {
            channelConfiguration = null;

            bool enabled;
            if (!TryReadBoolean(parameters, enabledParameter, out enabled, out problem))
            {
                return false;
            }

            string title;
            string body;
            string linkText;
            if (!TryReadText(parameters, titleParameter, MaximumSingleLineLength, out title, out problem)
                || !TryReadText(parameters, bodyParameter, MaximumBodyLength, out body, out problem)
                || !TryReadText(parameters, linkTextParameter, MaximumSingleLineLength, out linkText, out problem))
            {
                return false;
            }

            if (enabled && title == null)
            {
                problem = channel + " is switched on with no subject or title";
                return false;
            }
            if (enabled && body == null)
            {
                problem = channel + " is switched on with no message";
                return false;
            }

            channelConfiguration = new ChannelConfiguration(enabled, title, body, linkText);
            return true;
        }

        /// <summary>
        /// Reads a two-option parameter. Absent means off, which is the manifest's own
        /// default and what an unconfigured channel means. A value that is present and
        /// unreadable is refused: "perhaps on" is not a channel state.
        /// </summary>
        private static bool TryReadBoolean(
            IReadOnlyDictionary<string, MentionControlInstances.ParameterValue> parameters,
            string name,
            out bool value,
            out string problem)
        {
            value = false;
            problem = null;

            MentionControlInstances.ParameterValue parameter;
            if (!parameters.TryGetValue(name, out parameter))
            {
                return true;
            }
            if (!parameter.IsLiteral)
            {
                problem = name + " is bound to a column rather than configured";
                return false;
            }

            string text = parameter.Text == null ? string.Empty : parameter.Text.Trim();
            if (text.Length == 0)
            {
                return true;
            }
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase) || text == "1")
            {
                value = true;
                return true;
            }
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase) || text == "0")
            {
                value = false;
                return true;
            }

            problem = name + " is neither true nor false";
            return false;
        }

        /// <summary>
        /// Reads a text parameter. Unset and empty both become null, so that a form
        /// which leaves a subject blank and one which never had a subject are the same
        /// configuration rather than two that disagree.
        /// </summary>
        private static bool TryReadText(
            IReadOnlyDictionary<string, MentionControlInstances.ParameterValue> parameters,
            string name,
            int maximumLength,
            out string value,
            out string problem)
        {
            value = null;
            problem = null;

            MentionControlInstances.ParameterValue parameter;
            if (!parameters.TryGetValue(name, out parameter))
            {
                return true;
            }
            if (!parameter.IsLiteral)
            {
                problem = name + " is bound to a column rather than configured";
                return false;
            }

            string text = parameter.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                return true;
            }
            if (text.Length > maximumLength)
            {
                // Truncating would send most of a message and look like success. The
                // column's width is part of the contract, and a value that does not
                // fit is a configuration nobody can deliver as written.
                problem = name + " is longer than the "
                    + maximumLength.ToString(CultureInfo.InvariantCulture)
                    + " characters the event column holds";
                return false;
            }

            value = text;
            return true;
        }

        private static string Describe(PublishedForm form)
        {
            if (!string.IsNullOrWhiteSpace(form.Name))
            {
                return "'" + form.Name + "'";
            }

            return form.FormId ?? "(unnamed)";
        }
    }
}
