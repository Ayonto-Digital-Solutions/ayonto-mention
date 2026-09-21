using System.Collections.Generic;
using System.Globalization;
using Microsoft.Xrm.Sdk;

namespace Ayonto.Mention.Ingest.Tests.Fakes
{
    /// <summary>The tracing service, kept so a test can read what the ingest said.</summary>
    public sealed class FakeTracingService : ITracingService
    {
        public List<string> Lines { get; } = new List<string>();

        public void Trace(string format, params object[] args)
        {
            Lines.Add(args == null || args.Length == 0
                ? format
                : string.Format(CultureInfo.InvariantCulture, format, args));
        }

        /// <summary>True where some line contains this text.</summary>
        public bool Said(string fragment)
        {
            foreach (string line in Lines)
            {
                if (line.IndexOf(fragment, System.StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }

            return false;
        }

        public override string ToString()
        {
            return string.Join("\n", Lines);
        }
    }
}
