using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Identity;
using Ayonto.Mention.Ingest.Notifications;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Dataverse
{
    /// <summary>
    /// Reads the published, active forms of one table out of Dataverse.
    ///
    /// Three conditions, and each of them is a decision.
    ///
    /// `objecttypecode` is the table, which is the only half of the configuration
    /// identity a query can be narrowed by.
    ///
    /// `componentstate` is Published. `ComponentState` "distinguishes Published (0)
    /// from Unpublished (1)", and an unpublished form is a draft: a maker's work in
    /// progress must not decide how a notification that is being created right now is
    /// delivered.
    ///
    /// `formactivationstate` is Active. An inactive form is one a maker has switched
    /// off; counting it would let a form nobody can open create a configuration
    /// conflict with the form everybody uses.
    /// https://learn.microsoft.com/power-apps/developer/data-platform/reference/entities/systemform
    ///
    /// Form **type** is deliberately not filtered. A Mention control can sit on a main
    /// form, a quick create form, an interactive one; the product rule is that every
    /// published instance for one column agrees, and narrowing by type would quietly
    /// exempt whichever kind of form the filter forgot.
    /// </summary>
    public sealed class SystemFormSource : IPublishedFormSource
    {
        private const string FormTable = "systemform";
        private const int Published = 0;
        private const int Active = 1;

        /// <summary>
        /// How many forms are fetched at a time. A table with more published forms
        /// than this is unusual; a query that silently stopped at the first page would
        /// be a configuration conflict nobody sees.
        /// </summary>
        private const int PageSize = 250;

        /// <summary>
        /// How many pages are read before giving up. A bound, because this runs inside
        /// an asynchronous job with a hard time limit, and because an unbounded loop
        /// over a paged query is an unbounded loop.
        /// </summary>
        private const int MaximumPages = 40;

        private readonly IOrganizationService _service;

        public SystemFormSource(IOrganizationService service)
        {
            if (service == null)
            {
                throw new ArgumentNullException(nameof(service));
            }

            _service = service;
        }

        public IReadOnlyList<PublishedForm> FormsFor(string recordTable)
        {
            var forms = new List<PublishedForm>();
            if (string.IsNullOrWhiteSpace(recordTable))
            {
                return forms;
            }

            var query = new QueryExpression(FormTable)
            {
                ColumnSet = new ColumnSet("formid", "name", "formxml"),
                NoLock = true,
                PageInfo = new PagingInfo { Count = PageSize, PageNumber = 1 },
            };
            query.Criteria.AddCondition("objecttypecode", ConditionOperator.Equal, recordTable);
            query.Criteria.AddCondition("componentstate", ConditionOperator.Equal, Published);
            query.Criteria.AddCondition("formactivationstate", ConditionOperator.Equal, Active);
            query.Criteria.AddCondition("formxml", ConditionOperator.NotNull);
            // Ordered so that a trace naming "the other form" names the same form on
            // every run. A conflict that reads differently each time is a conflict
            // nobody can chase.
            query.AddOrder("formid", OrderType.Ascending);

            for (int page = 0; page < MaximumPages; page++)
            {
                EntityCollection found = _service.RetrieveMultiple(query);
                if (found == null)
                {
                    break;
                }

                foreach (Entity form in found.Entities)
                {
                    forms.Add(new PublishedForm(
                        ReadFormId(form),
                        form.GetAttributeValue<string>("name"),
                        form.GetAttributeValue<string>("formxml")));
                }

                if (!found.MoreRecords)
                {
                    break;
                }

                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = found.PagingCookie;
            }

            return forms;
        }

        private static string ReadFormId(Entity form)
        {
            return form.Id == Guid.Empty ? null : Identifiers.Normalize(form.Id);
        }
    }
}
