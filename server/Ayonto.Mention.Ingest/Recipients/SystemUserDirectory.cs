using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Recipients
{
    /// <summary>
    /// Resolves a claimed recipient against the `systemuser` table.
    ///
    /// A query rather than a retrieve, deliberately. `Retrieve` answers a row that is
    /// not there by throwing, and a plug-in that reads an untrusted identifier would
    /// then have to tell "no such user" — an ordinary outcome for an untrusted claim —
    /// apart from a platform fault it must not swallow. A query answers with no rows,
    /// and nothing has to be inferred from an exception.
    ///
    /// Only what is needed is read: whether the user exists, and whether they are
    /// disabled. No name and no address, because nothing downstream may take a
    /// recipient's identity from either.
    /// </summary>
    public sealed class SystemUserDirectory : IRecipientDirectory
    {
        private const string UserTable = "systemuser";

        private readonly IOrganizationService _service;

        public SystemUserDirectory(IOrganizationService service)
        {
            if (service == null)
            {
                throw new ArgumentNullException(nameof(service));
            }

            _service = service;
        }

        public RecipientResolution Resolve(Guid userId)
        {
            if (userId == Guid.Empty)
            {
                return RecipientResolution.Unknown();
            }

            var query = new QueryExpression(UserTable)
            {
                ColumnSet = new ColumnSet("isdisabled"),
                NoLock = true,
                TopCount = 1,
            };
            query.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);

            EntityCollection found = _service.RetrieveMultiple(query);
            if (found == null || found.Entities.Count == 0)
            {
                return RecipientResolution.Unknown();
            }

            Entity user = found.Entities[0];
            bool? disabled = user.GetAttributeValue<bool?>("isdisabled");
            if (disabled.GetValueOrDefault())
            {
                return RecipientResolution.Disabled();
            }

            return RecipientResolution.Active();
        }
    }
}
