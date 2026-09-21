using System;
using System.Collections.Generic;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Tests.Fakes
{
    /// <summary>
    /// A Dataverse that answers from a dictionary, and refuses the one table this
    /// product must never write.
    ///
    /// The refusal is the point of using it everywhere rather than a mocking library:
    /// every test that goes anywhere near the ledger runs against a service that throws
    /// if anything names `ayonto_mention`. A regression would not need a test of its
    /// own to be caught — it would fail whichever test happened to touch it.
    /// </summary>
    public sealed class FakeOrganizationService : IOrganizationService
    {
        /// <summary>
        /// The legacy table. Spelled out here rather than taken from the ingest's own
        /// constant, so that renaming the constant cannot silently disarm the guard.
        /// </summary>
        private const string ForbiddenTable = "ayonto_mention";

        private readonly Dictionary<string, Queue<EntityCollection>> _answers =
            new Dictionary<string, Queue<EntityCollection>>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Every query that was run, in order.</summary>
        public List<QueryExpression> Queries { get; } = new List<QueryExpression>();

        /// <summary>Every row that was created, in order.</summary>
        public List<Entity> Created { get; } = new List<Entity>();

        /// <summary>Answers the next query against this table with these rows.</summary>
        public FakeOrganizationService Answer(string entityName, params Entity[] rows)
        {
            return Answer(entityName, false, rows);
        }

        /// <summary>Answers the next query against this table, saying whether more pages follow.</summary>
        public FakeOrganizationService Answer(string entityName, bool moreRecords, params Entity[] rows)
        {
            var collection = new EntityCollection(new List<Entity>(rows))
            {
                EntityName = entityName,
                MoreRecords = moreRecords,
                PagingCookie = moreRecords ? "<cookie/>" : null,
            };

            Queue<EntityCollection> queued;
            if (!_answers.TryGetValue(entityName, out queued))
            {
                queued = new Queue<EntityCollection>();
                _answers.Add(entityName, queued);
            }

            queued.Enqueue(collection);
            return this;
        }

        public EntityCollection RetrieveMultiple(QueryBase query)
        {
            var expression = query as QueryExpression;
            if (expression == null)
            {
                throw new InvalidOperationException("the ingest only issues QueryExpression queries");
            }

            Refuse(expression.EntityName);
            Queries.Add(expression);

            Queue<EntityCollection> queued;
            if (!_answers.TryGetValue(expression.EntityName, out queued) || queued.Count == 0)
            {
                return new EntityCollection(new List<Entity>()) { EntityName = expression.EntityName };
            }

            return queued.Dequeue();
        }

        public Guid Create(Entity entity)
        {
            Refuse(entity.LogicalName);
            Created.Add(entity);
            return Guid.NewGuid();
        }

        private static void Refuse(string entityName)
        {
            if (string.Equals(entityName, ForbiddenTable, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "the Mention ingest must never touch " + ForbiddenTable
                    + " — the event ledger is ayonto_mentionevent");
            }
        }

        public void Update(Entity entity)
        {
            throw new NotSupportedException("the Mention ingest updates nothing");
        }

        public void Delete(string entityName, Guid id)
        {
            throw new NotSupportedException("the Mention ingest deletes nothing");
        }

        public Entity Retrieve(string entityName, Guid id, ColumnSet columnSet)
        {
            throw new NotSupportedException("the Mention ingest queries rather than retrieves");
        }

        public OrganizationResponse Execute(OrganizationRequest request)
        {
            throw new NotSupportedException("the Mention ingest issues no other requests");
        }

        public void Associate(string entityName, Guid id, Relationship relationship, EntityReferenceCollection related)
        {
            throw new NotSupportedException("the Mention ingest associates nothing");
        }

        public void Disassociate(string entityName, Guid id, Relationship relationship, EntityReferenceCollection related)
        {
            throw new NotSupportedException("the Mention ingest disassociates nothing");
        }
    }
}
