using System;
using Microsoft.Xrm.Sdk;

namespace Ayonto.Mention.Ingest.Tests.Fakes
{
    /// <summary>
    /// The execution context, set up the way a registration would produce it.
    ///
    /// Defaults are the registration this plug-in is written for: the `Update` message,
    /// PostOperation, asynchronous. A test that wants a wrong registration says so by
    /// changing one property, which is also how a wrong registration happens.
    /// </summary>
    public sealed class FakePluginExecutionContext : IPluginExecutionContext
    {
        public FakePluginExecutionContext()
        {
            MessageName = "Update";
            Stage = 40;
            Mode = 1;
            PrimaryEntityName = "ayonto_hosttable";
            PrimaryEntityId = Guid.NewGuid();
            InitiatingUserId = Guid.NewGuid();
            UserId = InitiatingUserId;
            InputParameters = new ParameterCollection();
            OutputParameters = new ParameterCollection();
            SharedVariables = new ParameterCollection();
            PreEntityImages = new EntityImageCollection();
            PostEntityImages = new EntityImageCollection();
            OperationCreatedOn = DateTime.UtcNow;
        }

        public int Stage { get; set; }

        public IPluginExecutionContext ParentContext { get; set; }

        public int Mode { get; set; }

        public int IsolationMode { get; set; }

        public int Depth { get; set; }

        public string MessageName { get; set; }

        public string PrimaryEntityName { get; set; }

        public Guid? RequestId { get; set; }

        public string SecondaryEntityName { get; set; }

        public ParameterCollection InputParameters { get; set; }

        public ParameterCollection OutputParameters { get; set; }

        public ParameterCollection SharedVariables { get; set; }

        public Guid UserId { get; set; }

        public Guid InitiatingUserId { get; set; }

        public Guid BusinessUnitId { get; set; }

        public Guid OrganizationId { get; set; }

        public string OrganizationName { get; set; }

        public Guid PrimaryEntityId { get; set; }

        public EntityImageCollection PreEntityImages { get; set; }

        public EntityImageCollection PostEntityImages { get; set; }

        public Guid CorrelationId { get; set; }

        public bool IsExecutingOffline { get; set; }

        public bool IsOfflinePlayback { get; set; }

        public bool IsInTransaction { get; set; }

        public Guid OperationId { get; set; }

        public DateTime OperationCreatedOn { get; set; }

        /// <summary>The plug-in step itself, which nothing in the ingest reads.</summary>
        public EntityReference OwningExtension { get; set; }
    }
}
