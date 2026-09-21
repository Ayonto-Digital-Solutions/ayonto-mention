using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Notifications;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace Ayonto.Mention.Ingest.Ledger
{
    /// <summary>
    /// The event ledger in Dataverse: `ayonto_mentionevent`, and nothing else.
    ///
    /// The service this is given is the authoritative one —
    /// `IOrganizationServiceFactory.CreateOrganizationService(null)`, where "a `null`
    /// value indicates the SYSTEM user" — so that an ordinary application user can save
    /// a business record without holding `Create` on the ledger, which is the privilege
    /// the design exists to take away from them.
    /// https://learn.microsoft.com/dotnet/api/microsoft.xrm.sdk.iorganizationservicefactory.createorganizationservice
    ///
    /// **SYSTEM is a privilege, not a reason to believe anything.** It says who may
    /// write the row; it says nothing about whether the row deserves to exist. Every
    /// check — the schema version, the column mapping the host declared, the recipient
    /// against `systemuser`, the configuration from published form metadata, the event
    /// identifier rules — has already run by the time anything here is called.
    /// Elevated context applied to unvalidated input is worse than no elevation at
    /// all, because it launders a claim into a fact.
    /// </summary>
    public sealed class MentionEventLedger : IMentionEventLedger
    {
        private readonly IOrganizationService _service;

        public MentionEventLedger(IOrganizationService service)
        {
            if (service == null)
            {
                throw new ArgumentNullException(nameof(service));
            }

            _service = service;
        }

        public IReadOnlyList<MentionEventIdentity> WithEventId(string eventId)
        {
            var identities = new List<MentionEventIdentity>();
            if (string.IsNullOrWhiteSpace(eventId))
            {
                return identities;
            }

            var query = new QueryExpression(MentionEventColumns.TableLogicalName)
            {
                ColumnSet = new ColumnSet(
                    MentionEventColumns.EventId,
                    MentionEventColumns.RecordTable,
                    MentionEventColumns.RecordId,
                    MentionEventColumns.SourceField,
                    MentionEventColumns.RecipientUserId),
                NoLock = true,
                // One event identifier belongs to one episode and one recipient, so one
                // row. More than one would be a defect rather than a page of results,
                // and a handful is enough to recognize that and refuse.
                TopCount = 10,
            };
            query.Criteria.AddCondition(MentionEventColumns.EventId, ConditionOperator.Equal, eventId);

            EntityCollection found = _service.RetrieveMultiple(query);
            if (found == null)
            {
                return identities;
            }

            foreach (Entity row in found.Entities)
            {
                identities.Add(new MentionEventIdentity(
                    Read(row, MentionEventColumns.EventId),
                    Read(row, MentionEventColumns.RecordTable),
                    Read(row, MentionEventColumns.RecordId),
                    Read(row, MentionEventColumns.SourceField),
                    Read(row, MentionEventColumns.RecipientUserId)));
            }

            return identities;
        }

        public void Create(MentionEventRow row)
        {
            if (row == null)
            {
                throw new ArgumentNullException(nameof(row));
            }

            var entity = new Entity(MentionEventColumns.TableLogicalName);
            entity[MentionEventColumns.Name] = Label(row.Identity);
            entity[MentionEventColumns.EventId] = row.Identity.EventId;
            entity[MentionEventColumns.RecordTable] = row.Identity.RecordTable;
            entity[MentionEventColumns.RecordId] = row.Identity.RecordId;
            entity[MentionEventColumns.SourceField] = row.Identity.SourceField;
            entity[MentionEventColumns.RecipientUserId] = row.Identity.RecipientUserId;
            entity[MentionEventColumns.InitiatingUserId] = row.InitiatingUserId;
            entity[MentionEventColumns.ConfigSchemaVersion] = NotificationConfiguration.SchemaVersion;

            Write(entity, row.Configuration.Email,
                MentionEventColumns.EmailEnabled,
                MentionEventColumns.EmailSubject,
                MentionEventColumns.EmailBody,
                MentionEventColumns.EmailLinkText);
            Write(entity, row.Configuration.Teams,
                MentionEventColumns.TeamsEnabled,
                MentionEventColumns.TeamsTitle,
                MentionEventColumns.TeamsBody,
                MentionEventColumns.TeamsLinkText);
            Write(entity, row.Configuration.InApp,
                MentionEventColumns.InAppEnabled,
                MentionEventColumns.InAppTitle,
                MentionEventColumns.InAppBody,
                MentionEventColumns.InAppLinkText);

            _service.Create(entity);
        }

        private static void Write(
            Entity entity,
            ChannelConfiguration channel,
            string enabledColumn,
            string titleColumn,
            string bodyColumn,
            string linkTextColumn)
        {
            entity[enabledColumn] = channel.Enabled;
            entity[titleColumn] = channel.Title;
            entity[bodyColumn] = channel.Body;
            entity[linkTextColumn] = channel.LinkText;
        }

        /// <summary>
        /// A readable label, and only that. It says which column on which table the
        /// mention was written in, because that is what helps somebody reading a grid.
        /// It carries no identifier, nothing resolves anything from it, and it is no
        /// part of the event's identity.
        /// </summary>
        private static string Label(MentionEventIdentity identity)
        {
            string label = "Mention · " + identity.RecordTable + "." + identity.SourceField;
            return label.Length <= MentionEventColumns.NameLength
                ? label
                : label.Substring(0, MentionEventColumns.NameLength);
        }

        private static string Read(Entity row, string column)
        {
            return row.GetAttributeValue<string>(column);
        }
    }
}
