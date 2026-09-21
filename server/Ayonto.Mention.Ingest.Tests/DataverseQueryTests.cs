using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Dataverse;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Recipients;
using Ayonto.Mention.Ingest.Tests.Fakes;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The two queries the ingest makes against platform tables, held to what they ask
    /// for rather than to what they happen to return. A query that quietly dropped the
    /// published condition would still pass a test that only checked its results.
    /// </summary>
    public sealed class DataverseQueryTests
    {
        private const string Table = "ayonto_hosttable";

        private static object ValueOf(QueryExpression query, string attribute)
        {
            foreach (ConditionExpression condition in query.Criteria.Conditions)
            {
                if (string.Equals(condition.AttributeName, attribute, StringComparison.Ordinal))
                {
                    return condition.Values.Count > 0 ? condition.Values[0] : null;
                }
            }

            throw new Xunit.Sdk.XunitException("the query does not filter on " + attribute);
        }

        private static ConditionOperator OperatorOf(QueryExpression query, string attribute)
        {
            foreach (ConditionExpression condition in query.Criteria.Conditions)
            {
                if (string.Equals(condition.AttributeName, attribute, StringComparison.Ordinal))
                {
                    return condition.Operator;
                }
            }

            throw new Xunit.Sdk.XunitException("the query does not filter on " + attribute);
        }

        [Fact]
        public void forms_are_asked_for_by_table_published_and_active()
        {
            var service = new FakeOrganizationService();
            new SystemFormSource(service).FormsFor(Table);

            QueryExpression query = Assert.Single(service.Queries);
            Assert.Equal("systemform", query.EntityName);
            Assert.Equal(Table, ValueOf(query, "objecttypecode"));
            Assert.Equal(0, ValueOf(query, "componentstate"));
            Assert.Equal(1, ValueOf(query, "formactivationstate"));
            Assert.Equal(ConditionOperator.NotNull, OperatorOf(query, "formxml"));
            Assert.Contains("formxml", query.ColumnSet.Columns);
            Assert.Contains("name", query.ColumnSet.Columns);
        }

        [Fact]
        public void form_type_is_deliberately_not_filtered()
        {
            // A Mention control can sit on a main form, a quick create form or an
            // interactive one, and every published instance for one column has to agree.
            // Narrowing by type would exempt whichever kind the filter forgot.
            var service = new FakeOrganizationService();
            new SystemFormSource(service).FormsFor(Table);

            foreach (ConditionExpression condition in Assert.Single(service.Queries).Criteria.Conditions)
            {
                Assert.NotEqual("type", condition.AttributeName);
            }
        }

        [Fact]
        public void forms_are_read_across_pages()
        {
            var first = new Entity("systemform", Guid.NewGuid());
            first["name"] = "Main";
            first["formxml"] = "<form />";
            var second = new Entity("systemform", Guid.NewGuid());
            second["name"] = "Quick Create";
            second["formxml"] = "<form />";

            var service = new FakeOrganizationService()
                .Answer("systemform", true, first)
                .Answer("systemform", false, second);

            IReadOnlyList<PublishedForm> forms = new SystemFormSource(service).FormsFor(Table);

            Assert.Equal(2, forms.Count);
            Assert.Equal("Main", forms[0].Name);
            Assert.Equal("Quick Create", forms[1].Name);
            Assert.Equal(2, service.Queries.Count);
        }

        [Fact]
        public void no_table_is_no_query()
        {
            var service = new FakeOrganizationService();

            Assert.Empty(new SystemFormSource(service).FormsFor(null));
            Assert.Empty(new SystemFormSource(service).FormsFor("   "));
            Assert.Empty(service.Queries);
        }

        [Fact]
        public void a_recipient_is_resolved_against_systemuser_by_identifier()
        {
            var user = new Guid("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
            var row = new Entity("systemuser", user);
            row["isdisabled"] = false;
            var service = new FakeOrganizationService().Answer("systemuser", row);

            RecipientResolution resolution = new SystemUserDirectory(service).Resolve(user);

            Assert.Equal(RecipientStatus.Active, resolution.Status);
            QueryExpression query = Assert.Single(service.Queries);
            Assert.Equal("systemuser", query.EntityName);
            Assert.Equal(user, ValueOf(query, "systemuserid"));
            // Only what is needed: not a name, not an address, because nothing
            // downstream may take a recipient's identity from either.
            Assert.Equal(new[] { "isdisabled" }, query.ColumnSet.Columns);
        }

        [Fact]
        public void a_recipient_who_does_not_exist_is_unknown_rather_than_an_exception()
        {
            var service = new FakeOrganizationService();

            Assert.Equal(RecipientStatus.Unknown, new SystemUserDirectory(service).Resolve(Guid.NewGuid()).Status);
        }

        [Fact]
        public void a_disabled_recipient_gets_no_new_notification_event()
        {
            var user = Guid.NewGuid();
            var row = new Entity("systemuser", user);
            row["isdisabled"] = true;
            var service = new FakeOrganizationService().Answer("systemuser", row);

            Assert.Equal(RecipientStatus.Disabled, new SystemUserDirectory(service).Resolve(user).Status);
        }

        [Fact]
        public void the_empty_identifier_is_nobody_and_is_not_looked_up()
        {
            var service = new FakeOrganizationService();

            Assert.Equal(RecipientStatus.Unknown, new SystemUserDirectory(service).Resolve(Guid.Empty).Status);
            Assert.Empty(service.Queries);
        }
    }
}
