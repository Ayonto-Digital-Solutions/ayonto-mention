using System;
using System.Reflection;
using Xunit;

namespace Ayonto.Mention.Ingest.Tests
{
    /// <summary>
    /// The identity Dataverse would register this assembly under.
    ///
    /// It is a test rather than a build setting because it is a contract rather than a
    /// preference. Microsoft requires a standalone plug-in assembly to be signed before
    /// it can be registered — "If you don't use the dependent assemblies capability, you
    /// must sign assemblies before you register them with Dataverse" — and the registered
    /// assembly is identified by its name, version and public key token. Change any of
    /// the three and the next import is a *different* assembly rather than an update of
    /// this one, and every registered step has to be pointed at it by hand.
    ///
    /// So the token is pinned. Regenerating the key is allowed; doing it without noticing
    /// is not.
    /// </summary>
    public sealed class AssemblyIdentityTests
    {
        /// <summary>
        /// The public key token of `Ayonto.Mention.Ingest.snk`, which is committed for
        /// exactly this reason: the identity has to be the same on every machine and in
        /// every build. A strong name is an identity and not an authentication — anyone
        /// can sign their own assembly with their own key — so the file is not a secret.
        /// </summary>
        private const string PublicKeyToken = "0e66244ba4f12435";

        private static AssemblyName IngestName
        {
            get { return typeof(MentionIngestPlugin).Assembly.GetName(); }
        }

        [Fact]
        public void the_ingest_assembly_is_strong_named()
        {
            byte[] key = IngestName.GetPublicKey();

            Assert.NotNull(key);
            Assert.NotEmpty(key);
        }

        [Fact]
        public void the_public_key_token_is_the_one_registrations_would_name()
        {
            byte[] token = IngestName.GetPublicKeyToken();

            Assert.NotNull(token);
            Assert.Equal(8, token.Length);
            Assert.Equal(PublicKeyToken, Hex(token));
        }

        [Fact]
        public void the_assembly_version_is_the_fixed_one()
        {
            // Not derived from the product version, deliberately. Raising it would make
            // the next import a different assembly rather than an update of this one.
            Assert.Equal(new Version(1, 0, 0, 0), IngestName.Version);
            Assert.Equal("Ayonto.Mention.Ingest", IngestName.Name);
        }

        [Fact]
        public void the_plug_in_type_is_the_name_a_step_registers_against()
        {
            // The string a host puts into a step registration, and the one the package
            // checker expects to find in a packaged assembly.
            Assert.Equal(
                "Ayonto.Mention.Ingest.MentionIngestPlugin",
                typeof(MentionIngestPlugin).FullName);
        }

        private static string Hex(byte[] value)
        {
            var built = new System.Text.StringBuilder(value.Length * 2);
            foreach (byte at in value)
            {
                built.Append(at.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
            }

            return built.ToString();
        }
    }
}
