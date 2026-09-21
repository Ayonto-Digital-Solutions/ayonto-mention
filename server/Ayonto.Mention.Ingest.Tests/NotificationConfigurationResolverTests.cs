using System.Collections.Generic;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Tests.Fakes;
using Ayonto.Mention.Ingest.Tests.Support;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// Where notification configuration actually comes from: published form metadata,
    /// per table and column, failing closed wherever the answer is not exactly one.
    ///
    /// The conflict cases are the ones worth having. Choosing arbitrarily among
    /// disagreeing configurations produces a message whose channels and wording depend
    /// on which row a query happened to return first — a defect that stays invisible
    /// until it sends the wrong text to exactly the right person.
    /// </summary>
    public sealed class NotificationConfigurationResolverTests
    {
        private const string Table = "ayonto_hosttable";
        private const string Field = "description";

        private static NotificationConfigurationResult Resolve(FakePublishedFormSource forms)
        {
            return new NotificationConfigurationResolver(forms).Resolve(Table, Field);
        }

        [Fact]
        public void reads_every_channel_setting_the_maker_configured()
        {
            NotificationConfigurationResult result = Resolve(
                new FakePublishedFormSource().With(Table, "Main", Forms.With(Field, Forms.AllChannelsOn())));

            Assert.Equal(NotificationConfigurationStatus.Resolved, result.Status);
            NotificationConfiguration configuration = result.Configuration;

            Assert.True(configuration.Email.Enabled);
            Assert.Equal("You were mentioned", configuration.Email.Title);
            Assert.Equal("Somebody mentioned you.", configuration.Email.Body);
            Assert.Equal("Open the record", configuration.Email.LinkText);

            Assert.True(configuration.Teams.Enabled);
            Assert.Equal("Mentioned", configuration.Teams.Title);
            Assert.Equal("Open", configuration.Teams.LinkText);

            Assert.True(configuration.InApp.Enabled);
            Assert.Equal("Mentioned", configuration.InApp.Title);
            Assert.Equal("Show me", configuration.InApp.LinkText);
        }

        [Fact]
        public void a_channel_the_maker_left_alone_is_off_with_nothing_in_it()
        {
            NotificationConfigurationResult result = Resolve(
                new FakePublishedFormSource().With(Table, "Main", Forms.With(Field, Forms.EmailOnly())));

            Assert.Equal(NotificationConfigurationStatus.Resolved, result.Status);
            Assert.True(result.Configuration.Email.Enabled);
            Assert.False(result.Configuration.Teams.Enabled);
            Assert.Null(result.Configuration.Teams.Title);
            Assert.False(result.Configuration.InApp.Enabled);
            Assert.Null(result.Configuration.InApp.LinkText);
        }

        [Fact]
        public void a_control_with_no_notification_settings_at_all_is_a_configuration_that_sends_nothing()
        {
            // Not a refusal. A form that was never configured for notifications is a
            // field somebody mentions people in without telling anybody, and the event
            // is still the product's record that it happened.
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, new Dictionary<string, string>())));

            Assert.Equal(NotificationConfigurationStatus.Resolved, result.Status);
            Assert.False(result.Configuration.Email.Enabled);
            Assert.False(result.Configuration.Teams.Enabled);
            Assert.False(result.Configuration.InApp.Enabled);
        }

        [Fact]
        public void no_published_form_carrying_the_control_is_no_configuration()
        {
            Assert.Equal(
                NotificationConfigurationStatus.NotConfigured,
                Resolve(new FakePublishedFormSource()).Status);

            Assert.Equal(
                NotificationConfigurationStatus.NotConfigured,
                Resolve(new FakePublishedFormSource()
                    .With(Table, "Main", "<form><tabs /></form>")).Status);
        }

        [Fact]
        public void several_forms_carrying_the_same_configuration_agree()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, Forms.EmailOnly()))
                .With(Table, "Quick Create", Forms.With(Field, Forms.EmailOnly()))
                .With(Table, "Interactive", Forms.With(Field, Forms.EmailOnly())));

            Assert.Equal(NotificationConfigurationStatus.Resolved, result.Status);
            Assert.True(result.Configuration.Email.Enabled);
        }

        [Fact]
        public void forms_that_disagree_fail_closed_and_name_both()
        {
            var different = new Dictionary<string, string>(Forms.EmailOnly());
            different["emailSubject"] = "Something else entirely";

            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, Forms.EmailOnly()))
                .With(Table, "Quick Create", Forms.With(Field, different)));

            Assert.Equal(NotificationConfigurationStatus.Conflicting, result.Status);
            Assert.Null(result.Configuration);
            Assert.Contains("Quick Create", result.Problem);
            Assert.Contains("Main", result.Problem);
        }

        [Fact]
        public void a_channel_switched_on_with_nothing_to_say_is_refused()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, new Dictionary<string, string>
                {
                    { "emailEnabled", "true" },
                })));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("no subject or title", result.Problem);
        }

        [Fact]
        public void a_channel_switched_on_with_a_subject_and_no_message_is_refused()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, new Dictionary<string, string>
                {
                    { "teamsEnabled", "1" },
                    { "teamsTitle", "Mentioned" },
                })));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("no message", result.Problem);
        }

        [Fact]
        public void a_switch_that_is_neither_true_nor_false_is_refused()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, new Dictionary<string, string>
                {
                    { "inAppEnabled", "perhaps" },
                })));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("neither true nor false", result.Problem);
        }

        [Fact]
        public void the_switches_are_read_as_dataverse_writes_two_options()
        {
            foreach (string on in new[] { "true", "TRUE", "1" })
            {
                var settings = new Dictionary<string, string>(Forms.EmailOnly());
                settings["emailEnabled"] = on;
                Assert.True(Resolve(new FakePublishedFormSource()
                    .With(Table, "Main", Forms.With(Field, settings))).Configuration.Email.Enabled, on);
            }

            foreach (string off in new[] { "false", "False", "0", "" })
            {
                var settings = new Dictionary<string, string> { { "emailEnabled", off } };
                Assert.False(Resolve(new FakePublishedFormSource()
                    .With(Table, "Main", Forms.With(Field, settings))).Configuration.Email.Enabled, off);
            }
        }

        [Fact]
        public void a_setting_bound_to_a_column_rather_than_configured_is_refused()
        {
            // Its text would be a column's logical name, and reading one as a subject
            // line would put that name into somebody's inbox.
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(
                    Forms.MentionControl,
                    Field,
                    Field,
                    Forms.EmailOnly(),
                    bindThroughDataFieldName: false,
                    staticValues: false)));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("bound to a column", result.Problem);
        }

        [Fact]
        public void a_value_longer_than_the_column_that_has_to_hold_it_is_refused()
        {
            var settings = new Dictionary<string, string>(Forms.EmailOnly());
            settings["emailSubject"] = new string('a', 4001);

            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, settings)));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("longer than", result.Problem);
        }

        [Fact]
        public void a_form_whose_xml_cannot_be_read_stops_the_resolution()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(Field, Forms.EmailOnly()))
                .With(Table, "Broken", "<form><tabs>"));

            Assert.Equal(NotificationConfigurationStatus.Invalid, result.Status);
            Assert.Contains("Broken", result.Problem);
        }

        [Fact]
        public void a_control_configured_for_another_column_is_not_this_column_s_configuration()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With("ayonto_notes", Forms.AllChannelsOn())));

            Assert.Equal(NotificationConfigurationStatus.NotConfigured, result.Status);
        }

        [Fact]
        public void another_code_component_on_the_same_column_is_ignored()
        {
            // The productive legacy control lives in the same environments under the
            // same publisher and knows nothing about this configuration.
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(
                    Forms.LegacyControl,
                    Field,
                    Field,
                    Forms.AllChannelsOn(),
                    bindThroughDataFieldName: false,
                    staticValues: true)));

            Assert.Equal(NotificationConfigurationStatus.NotConfigured, result.Status);
        }

        [Fact]
        public void a_control_that_names_no_field_parameter_is_matched_through_the_layout_binding()
        {
            NotificationConfigurationResult result = Resolve(new FakePublishedFormSource()
                .With(Table, "Main", Forms.With(
                    Forms.MentionControl,
                    Field,
                    null,
                    Forms.EmailOnly(),
                    bindThroughDataFieldName: true,
                    staticValues: true)));

            Assert.Equal(NotificationConfigurationStatus.Resolved, result.Status);
            Assert.True(result.Configuration.Email.Enabled);
        }

        [Fact]
        public void resolution_asks_about_the_table_it_was_given()
        {
            var forms = new FakePublishedFormSource();
            new NotificationConfigurationResolver(forms).Resolve(Table, Field);

            Assert.Equal(Table, Assert.Single(forms.AskedFor));
        }

        [Fact]
        public void nothing_to_resolve_is_refused_rather_than_answered()
        {
            var resolver = new NotificationConfigurationResolver(new FakePublishedFormSource());

            Assert.Equal(NotificationConfigurationStatus.Invalid, resolver.Resolve(null, Field).Status);
            Assert.Equal(NotificationConfigurationStatus.Invalid, resolver.Resolve(Table, "  ").Status);
        }
    }
}
