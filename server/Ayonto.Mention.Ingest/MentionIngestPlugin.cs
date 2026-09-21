using System;
using System.Collections.Generic;
using Ayonto.Mention.Ingest.Configuration;
using Ayonto.Mention.Ingest.Dataverse;
using Ayonto.Mention.Ingest.Identity;
using Ayonto.Mention.Ingest.Ledger;
using Ayonto.Mention.Ingest.Notifications;
using Ayonto.Mention.Ingest.Recipients;
using Microsoft.Xrm.Sdk;

namespace Ayonto.Mention.Ingest
{
    /// <summary>
    /// The plug-in: the thin piece that takes the platform apart and hands the ingest
    /// what it needs.
    ///
    /// Everything that decides anything is somewhere else, and that is the point — a
    /// handler whose logic lives inside `Execute(IServiceProvider)` is a handler that
    /// can only be tested by running Dataverse. What happens here is exactly four
    /// things: check that the registration is the one this code was written for, read
    /// the step's column mapping, lift the trusted values and the images out of the
    /// execution context, and open the authoritative service the ledger write needs.
    ///
    /// **Why a wrong registration is sometimes loud and sometimes silent.** Registered
    /// asynchronously — which is how it is meant to be registered — a throw fails the
    /// system job, shows up in the environment's system jobs, and cannot touch the
    /// record that was already saved. So a registration mistake throws, because a
    /// notification pipeline that quietly does nothing is worse than one that says it
    /// is broken. Registered *synchronously*, a throw is a different thing entirely:
    /// the step runs inside the database transaction and the exception would roll back
    /// somebody's business record over a notification defect. That must never happen,
    /// so in synchronous mode this traces what is wrong and returns.
    /// </summary>
    public sealed class MentionIngestPlugin : IPlugin
    {
        private readonly string _unsecureConfiguration;

        /// <summary>
        /// The constructor Dataverse calls, with the step's two configurations.
        ///
        /// The secure half is deliberately unused. Nothing this handler needs is a
        /// secret, and secure configuration "isn't included with the step registration
        /// when you export a solution" — so a mapping kept there would travel with
        /// neither the host solution nor a review of it.
        /// </summary>
        public MentionIngestPlugin(string unsecureConfiguration, string secureConfiguration)
        {
            _unsecureConfiguration = unsecureConfiguration;
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            if (serviceProvider == null)
            {
                throw new ArgumentNullException(nameof(serviceProvider));
            }

            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));

            if (trace == null || context == null || factory == null)
            {
                throw new InvalidPluginExecutionException(
                    "the Mention ingest was invoked without the tracing service, the execution context or the service factory");
            }

            bool asynchronous = context.Mode == PluginRegistration.AsynchronousMode;

            string wrong = WrongRegistration(context);
            if (wrong != null)
            {
                Refuse(trace, asynchronous, wrong);
                return;
            }

            StepConfiguration configuration;
            string problem;
            if (!StepConfiguration.TryParse(_unsecureConfiguration, out configuration, out problem))
            {
                Refuse(trace, asynchronous, "the step's unsecure configuration is not a column mapping: " + problem);
                return;
            }

            Entity postImage;
            if (!context.PostEntityImages.TryGetValue(PluginRegistration.PostImageAlias, out postImage)
                || postImage == null)
            {
                Refuse(
                    trace,
                    asynchronous,
                    "the step has no post image registered under the alias '"
                    + PluginRegistration.PostImageAlias
                    + "', so the committed text and companion metadata cannot be read");
                return;
            }

            Entity preImage = null;
            bool isUpdate = string.Equals(context.MessageName, PluginRegistration.UpdateMessage, StringComparison.Ordinal);
            if (isUpdate
                && (!context.PreEntityImages.TryGetValue(PluginRegistration.PreImageAlias, out preImage)
                    || preImage == null))
            {
                // Without it the handler cannot tell an update that changed the mentions
                // from one that merely carried the column along, and a filtering
                // attribute does not tell it either.
                Refuse(
                    trace,
                    asynchronous,
                    "the Update step has no pre image registered under the alias '"
                    + PluginRegistration.PreImageAlias
                    + "', so changed metadata cannot be told from unchanged metadata");
                return;
            }

            if (context.PrimaryEntityId == Guid.Empty || string.IsNullOrWhiteSpace(context.PrimaryEntityName))
            {
                Refuse(trace, asynchronous, "the execution context names no primary record");
                return;
            }

            var request = new IngestRequest(
                context.MessageName,
                context.PrimaryEntityName.ToLowerInvariant(),
                Identifiers.Normalize(context.PrimaryEntityId),
                Identifiers.Normalize(context.InitiatingUserId),
                Read(postImage, configuration, includeSourceText: true),
                isUpdate ? Read(preImage, configuration, includeSourceText: false) : null);

            // Two services, and which is which is the security design rather than a
            // detail. "When called in a plug-in, a `null` value indicates the SYSTEM user
            // and a `Guid.Empty` value indicates the same user as
            // IPluginExecutionContext.UserId. Any other value indicates a specific system
            // user."
            // https://learn.microsoft.com/dotnet/api/microsoft.xrm.sdk.iorganizationservicefactory.createorganizationservice
            //
            // SYSTEM carries the two operations that are about product state: reading the
            // published form configuration, and writing the ledger. The ledger write needs
            // it — an ordinary user must be able to save a host record without holding
            // Create on the event table — and the configuration read needs it so that the
            // same mention on the same field resolves the same way whoever pressed save.
            // Neither returns anything to anybody.
            //
            // The recipient is resolved as the **initiating user**, because that
            // resolution is an authorization. Anybody who may write the source text may
            // write any identifier into the companion column, and SYSTEM would happily
            // confirm a user the person saving the record has no business naming. Asked in
            // their context, a recipient they cannot see does not resolve and no event is
            // created.
            //
            // InitiatingUserId rather than UserId: the actor is whoever caused the
            // operation, and a step registered to run as somebody else must not widen what
            // that actor is allowed to reach.
            IOrganizationService system = factory.CreateOrganizationService(null);
            IOrganizationService initiatingUser = factory.CreateOrganizationService(context.InitiatingUserId);

            var ingest = new MentionIngest(
                new NotificationConfigurationResolver(new SystemFormSource(system)),
                new SystemUserDirectory(initiatingUser),
                new MentionEventLedger(system),
                trace);

            ingest.Run(request, configuration);
        }

        /// <summary>
        /// What is wrong with this registration, or null where nothing is.
        ///
        /// Three things are checked, and each of them changes what the code below would
        /// mean: a message other than `Create` or `Update` has no post image to speak
        /// of, a stage before PostOperation has no committed record, and the mode decides
        /// whether a failure here could reach somebody's save.
        /// </summary>
        private static string WrongRegistration(IPluginExecutionContext context)
        {
            bool known = string.Equals(context.MessageName, PluginRegistration.CreateMessage, StringComparison.Ordinal)
                || string.Equals(context.MessageName, PluginRegistration.UpdateMessage, StringComparison.Ordinal);
            if (!known)
            {
                return "registered on the message '" + context.MessageName
                    + "'; the Mention ingest handles Create and Update";
            }
            if (context.Stage != PluginRegistration.PostOperationStage)
            {
                return "registered at stage " + context.Stage.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + "; the Mention ingest is a PostOperation step";
            }
            if (context.Mode != PluginRegistration.AsynchronousMode)
            {
                return "registered synchronously; the Mention ingest must be asynchronous so that a "
                    + "notification failure can never roll back the record that was saved";
            }

            return null;
        }

        /// <summary>
        /// Says what is wrong, and throws only where throwing is safe.
        ///
        /// Asynchronous: the record is already committed, the exception fails the system
        /// job and nothing else, and a misregistration that fails visibly is a
        /// misregistration somebody fixes. Synchronous: the step is inside the
        /// transaction, and an exception here would refuse a business record over a
        /// notification. It traces and returns instead — which is also, in itself, the
        /// registration mistake being reported.
        /// </summary>
        private static void Refuse(ITracingService trace, bool asynchronous, string problem)
        {
            trace.Trace("mention ingest: {0}", problem);
            if (asynchronous)
            {
                throw new InvalidPluginExecutionException("Mention ingest: " + problem);
            }
        }

        /// <summary>
        /// Lifts the mapped columns out of an entity image, and only those.
        ///
        /// String columns only, because that is what both halves are: the source text is
        /// a text column and the companion metadata is a memo column. Anything else
        /// under one of those names is a registration pointing at the wrong column, and
        /// it arrives here as nothing rather than as a value to make sense of.
        /// </summary>
        private static IReadOnlyDictionary<string, string> Read(
            Entity image,
            StepConfiguration configuration,
            bool includeSourceText)
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (FieldMapping mapping in configuration.Mappings)
            {
                if (includeSourceText)
                {
                    Copy(image, mapping.SourceField, values);
                }

                Copy(image, mapping.MetadataField, values);
            }

            return values;
        }

        private static void Copy(Entity image, string column, Dictionary<string, string> values)
        {
            object value;
            if (!image.Attributes.TryGetValue(column, out value))
            {
                return;
            }

            var text = value as string;
            if (text != null)
            {
                values[column] = text;
            }
        }
    }
}
