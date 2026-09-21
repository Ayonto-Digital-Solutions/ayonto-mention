using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Ayonto.Mention.Ingest.Json
{
    /// <summary>
    /// A strict JSON reader, written here rather than taken from a package.
    ///
    /// Two reasons, and neither is a preference. Microsoft's own guidance for
    /// plug-ins is "Don't depend on System.Text.Json", because the
    /// `System.Text.Json.dll` in the sandbox runtime "might not be the same version
    /// that you refer to in your project", and pinning one means shipping it in a
    /// plug-in package. Newtonsoft.Json is not in the sandbox at all without the
    /// same treatment, and ILMerge — the other way people reach for — is not
    /// supported: "Microsoft doesn't support ILMerge."
    /// https://learn.microsoft.com/power-apps/developer/data-platform/build-and-package
    ///
    /// The second reason is the one that would matter even without the first. This
    /// reads a string out of a column that anybody who may write the business text
    /// may write, so what it does with malformed, hostile or merely surprising
    /// input is part of the security boundary. A reader small enough to read is a
    /// reader whose behaviour on that input can be stated:
    ///
    /// * exactly RFC 8259 — no comments, no trailing commas, no single quotes, no
    ///   unquoted names, no NaN or Infinity literals;
    /// * duplicate member names are refused rather than resolved, because a
    ///   payload that names `eventId` twice is not a payload with one `eventId`;
    /// * nesting and length are bounded, so a small string cannot cost a large
    ///   amount of stack or time;
    /// * a failure is `false`, never an exception, and never a partial value.
    ///
    /// Pure: no Dataverse, no platform, nothing but the string it is handed.
    /// </summary>
    public static class JsonReader
    {
        /// <summary>
        /// How deep a document may nest. The payload this exists for is three deep
        /// (envelope, mentions, occurrences); the rest of the allowance is room for
        /// a shape to grow, not an invitation.
        /// </summary>
        public const int MaximumDepth = 16;

        /// <summary>
        /// How long a document may be. A companion column is a memo column and
        /// could hold megabytes; the payload for one editing session is a few
        /// hundred bytes per mention. A bound keeps a pathological value from
        /// becoming a pathological amount of work in an asynchronous job that has
        /// a hard time limit.
        /// </summary>
        public const int MaximumLength = 1024 * 1024;

        /// <summary>
        /// Reads a whole JSON document, or reports that this was not one.
        /// </summary>
        /// <param name="text">The raw value, exactly as the column holds it.</param>
        /// <param name="value">The parsed document, or null.</param>
        /// <param name="problem">A short, non-sensitive description of what was wrong.</param>
        public static bool TryRead(string text, out JsonValue value, out string problem)
        {
            value = null;
            problem = null;

            if (text == null)
            {
                problem = "no value";
                return false;
            }
            if (text.Length > MaximumLength)
            {
                problem = "longer than " + MaximumLength.ToString(CultureInfo.InvariantCulture) + " characters";
                return false;
            }

            var cursor = new Cursor(text);
            cursor.SkipWhitespace();

            JsonValue parsed;
            if (!TryReadValue(cursor, 0, out parsed, out problem))
            {
                return false;
            }

            cursor.SkipWhitespace();
            if (!cursor.AtEnd)
            {
                problem = "trailing content at " + cursor.Position.ToString(CultureInfo.InvariantCulture);
                return false;
            }

            value = parsed;
            return true;
        }

        private static bool TryReadValue(Cursor cursor, int depth, out JsonValue value, out string problem)
        {
            value = null;
            problem = null;

            if (depth > MaximumDepth)
            {
                problem = "nested deeper than " + MaximumDepth.ToString(CultureInfo.InvariantCulture);
                return false;
            }
            if (cursor.AtEnd)
            {
                problem = "ended where a value was expected";
                return false;
            }

            switch (cursor.Current)
            {
                case '{':
                    return TryReadObject(cursor, depth, out value, out problem);
                case '[':
                    return TryReadArray(cursor, depth, out value, out problem);
                case '"':
                    string text;
                    if (!TryReadString(cursor, out text, out problem))
                    {
                        return false;
                    }
                    value = JsonValue.String(text);
                    return true;
                case 't':
                    if (!cursor.TryTake("true", out problem))
                    {
                        return false;
                    }
                    value = JsonValue.Boolean(true);
                    return true;
                case 'f':
                    if (!cursor.TryTake("false", out problem))
                    {
                        return false;
                    }
                    value = JsonValue.Boolean(false);
                    return true;
                case 'n':
                    if (!cursor.TryTake("null", out problem))
                    {
                        return false;
                    }
                    value = JsonValue.Null();
                    return true;
                default:
                    return TryReadNumber(cursor, out value, out problem);
            }
        }

        private static bool TryReadObject(Cursor cursor, int depth, out JsonValue value, out string problem)
        {
            value = null;
            cursor.Advance();
            var members = new Dictionary<string, JsonValue>(StringComparer.Ordinal);

            cursor.SkipWhitespace();
            if (cursor.Current == '}')
            {
                cursor.Advance();
                value = JsonValue.Object(members);
                problem = null;
                return true;
            }

            while (true)
            {
                cursor.SkipWhitespace();
                if (cursor.AtEnd || cursor.Current != '"')
                {
                    problem = "member name expected at " + cursor.Position.ToString(CultureInfo.InvariantCulture);
                    return false;
                }

                string name;
                if (!TryReadString(cursor, out name, out problem))
                {
                    return false;
                }
                if (members.ContainsKey(name))
                {
                    // Not resolved in either direction: two values under one name
                    // is a document with no single answer, and picking one is how
                    // a reader and a writer come to disagree about what was sent.
                    problem = "the member is named twice";
                    return false;
                }

                cursor.SkipWhitespace();
                if (cursor.AtEnd || cursor.Current != ':')
                {
                    problem = "':' expected at " + cursor.Position.ToString(CultureInfo.InvariantCulture);
                    return false;
                }
                cursor.Advance();
                cursor.SkipWhitespace();

                JsonValue member;
                if (!TryReadValue(cursor, depth + 1, out member, out problem))
                {
                    return false;
                }
                members.Add(name, member);

                cursor.SkipWhitespace();
                if (cursor.AtEnd)
                {
                    problem = "ended inside an object";
                    return false;
                }
                if (cursor.Current == ',')
                {
                    cursor.Advance();
                    continue;
                }
                if (cursor.Current == '}')
                {
                    cursor.Advance();
                    value = JsonValue.Object(members);
                    problem = null;
                    return true;
                }

                problem = "',' or '}' expected at " + cursor.Position.ToString(CultureInfo.InvariantCulture);
                return false;
            }
        }

        private static bool TryReadArray(Cursor cursor, int depth, out JsonValue value, out string problem)
        {
            value = null;
            cursor.Advance();
            var items = new List<JsonValue>();

            cursor.SkipWhitespace();
            if (cursor.Current == ']')
            {
                cursor.Advance();
                value = JsonValue.Array(items);
                problem = null;
                return true;
            }

            while (true)
            {
                cursor.SkipWhitespace();

                JsonValue item;
                if (!TryReadValue(cursor, depth + 1, out item, out problem))
                {
                    return false;
                }
                items.Add(item);

                cursor.SkipWhitespace();
                if (cursor.AtEnd)
                {
                    problem = "ended inside an array";
                    return false;
                }
                if (cursor.Current == ',')
                {
                    cursor.Advance();
                    continue;
                }
                if (cursor.Current == ']')
                {
                    cursor.Advance();
                    value = JsonValue.Array(items);
                    problem = null;
                    return true;
                }

                problem = "',' or ']' expected at " + cursor.Position.ToString(CultureInfo.InvariantCulture);
                return false;
            }
        }

        private static bool TryReadString(Cursor cursor, out string text, out string problem)
        {
            text = null;
            problem = null;
            cursor.Advance();
            var built = new StringBuilder();

            while (true)
            {
                if (cursor.AtEnd)
                {
                    problem = "ended inside a string";
                    return false;
                }

                char character = cursor.Current;
                cursor.Advance();

                if (character == '"')
                {
                    text = built.ToString();
                    return true;
                }
                if (character != '\\')
                {
                    // RFC 8259: the control characters have to be escaped, so an
                    // unescaped one is not this string's author being terse.
                    if (character < 0x20)
                    {
                        problem = "unescaped control character in a string";
                        return false;
                    }
                    built.Append(character);
                    continue;
                }

                if (cursor.AtEnd)
                {
                    problem = "ended inside an escape";
                    return false;
                }

                char escaped = cursor.Current;
                cursor.Advance();
                switch (escaped)
                {
                    case '"': built.Append('"'); break;
                    case '\\': built.Append('\\'); break;
                    case '/': built.Append('/'); break;
                    case 'b': built.Append('\b'); break;
                    case 'f': built.Append('\f'); break;
                    case 'n': built.Append('\n'); break;
                    case 'r': built.Append('\r'); break;
                    case 't': built.Append('\t'); break;
                    case 'u':
                        int code;
                        if (!TryReadHexQuad(cursor, out code))
                        {
                            problem = "malformed \\u escape";
                            return false;
                        }
                        built.Append((char)code);
                        break;
                    default:
                        problem = "unknown escape";
                        return false;
                }
            }
        }

        private static bool TryReadHexQuad(Cursor cursor, out int code)
        {
            code = 0;
            for (int digit = 0; digit < 4; digit++)
            {
                if (cursor.AtEnd)
                {
                    return false;
                }

                int value = HexDigit(cursor.Current);
                if (value < 0)
                {
                    return false;
                }
                code = (code << 4) | value;
                cursor.Advance();
            }

            return true;
        }

        private static int HexDigit(char character)
        {
            if (character >= '0' && character <= '9')
            {
                return character - '0';
            }
            if (character >= 'a' && character <= 'f')
            {
                return character - 'a' + 10;
            }
            if (character >= 'A' && character <= 'F')
            {
                return character - 'A' + 10;
            }

            return -1;
        }

        /// <summary>
        /// Reads a number in exactly the grammar JSON defines: an optional minus,
        /// an integer part with no leading zero, an optional fraction, an optional
        /// exponent. `+1`, `01`, `.5`, `1.`, `Infinity` and `NaN` are all refused,
        /// which is the difference between this and asking double.TryParse.
        /// </summary>
        private static bool TryReadNumber(Cursor cursor, out JsonValue value, out string problem)
        {
            value = null;
            int from = cursor.Position;

            if (cursor.Current == '-')
            {
                cursor.Advance();
            }

            if (cursor.AtEnd || !IsDigit(cursor.Current))
            {
                problem = "a value expected at " + from.ToString(CultureInfo.InvariantCulture);
                return false;
            }

            if (cursor.Current == '0')
            {
                cursor.Advance();
                if (!cursor.AtEnd && IsDigit(cursor.Current))
                {
                    problem = "leading zero in a number";
                    return false;
                }
            }
            else
            {
                while (!cursor.AtEnd && IsDigit(cursor.Current))
                {
                    cursor.Advance();
                }
            }

            if (!cursor.AtEnd && cursor.Current == '.')
            {
                cursor.Advance();
                if (cursor.AtEnd || !IsDigit(cursor.Current))
                {
                    problem = "a fraction with no digits";
                    return false;
                }
                while (!cursor.AtEnd && IsDigit(cursor.Current))
                {
                    cursor.Advance();
                }
            }

            if (!cursor.AtEnd && (cursor.Current == 'e' || cursor.Current == 'E'))
            {
                cursor.Advance();
                if (!cursor.AtEnd && (cursor.Current == '+' || cursor.Current == '-'))
                {
                    cursor.Advance();
                }
                if (cursor.AtEnd || !IsDigit(cursor.Current))
                {
                    problem = "an exponent with no digits";
                    return false;
                }
                while (!cursor.AtEnd && IsDigit(cursor.Current))
                {
                    cursor.Advance();
                }
            }

            string literal = cursor.Slice(from);
            double number;
            if (!double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out number))
            {
                problem = "a number that does not fit";
                return false;
            }

            value = JsonValue.Number(number);
            problem = null;
            return true;
        }

        private static bool IsDigit(char character)
        {
            return character >= '0' && character <= '9';
        }

        /// <summary>Where the reader is in the text, and nothing else.</summary>
        private sealed class Cursor
        {
            private readonly string _text;
            private int _at;

            internal Cursor(string text)
            {
                _text = text;
                _at = 0;
            }

            internal bool AtEnd
            {
                get { return _at >= _text.Length; }
            }

            /// <summary>The character under the cursor, or NUL at the end.</summary>
            internal char Current
            {
                get { return _at < _text.Length ? _text[_at] : '\0'; }
            }

            internal int Position
            {
                get { return _at; }
            }

            internal void Advance()
            {
                _at++;
            }

            /// <summary>
            /// The four characters JSON counts as whitespace, and only those. A
            /// vertical tab or a non-breaking space between two tokens is not
            /// whitespace here, because RFC 8259 does not say it is.
            /// </summary>
            internal void SkipWhitespace()
            {
                while (_at < _text.Length)
                {
                    char character = _text[_at];
                    if (character != ' ' && character != '\t' && character != '\n' && character != '\r')
                    {
                        return;
                    }
                    _at++;
                }
            }

            internal bool TryTake(string literal, out string problem)
            {
                if (string.CompareOrdinal(_text, _at, literal, 0, literal.Length) != 0
                    || _at + literal.Length > _text.Length)
                {
                    problem = "expected '" + literal + "' at " + _at.ToString(CultureInfo.InvariantCulture);
                    return false;
                }

                _at += literal.Length;
                problem = null;
                return true;
            }

            internal string Slice(int from)
            {
                return _text.Substring(from, _at - from);
            }
        }
    }
}
