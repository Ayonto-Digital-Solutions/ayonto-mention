import * as fs from "node:fs";
import * as path from "node:path";

import { readResources } from "./support/resources";

/**
 * The notification configuration surface, as the maker is offered it.
 *
 * Twelve input properties — three channels, each with an on/off switch and the
 * content that channel needs. They are the one place a maker configures how a
 * mention on this field becomes a notification, and that is the entire job they
 * do here: the control reads none of them and sends nothing. Dataverse persists
 * them in the published form metadata, and the server reads *that* and validates
 * it before an event exists. See docs/server-architecture.md.
 *
 * Which makes this file a contract test rather than a behaviour test. What could
 * go wrong is not that a value is computed incorrectly — nothing computes one —
 * but that the shipped manifest quietly stops saying what the server was written
 * to read, or that somebody wires a setting into the payload and turns a maker's
 * form configuration into delivery authority. Both are checked against the files
 * that actually ship.
 */

const CONTROL = path.join(__dirname, "..", "MentionControl");
const manifest = fs.readFileSync(path.join(CONTROL, "ControlManifest.Input.xml"), "utf8");

/** The version this component ships under, everywhere it is declared. */
const CONTROL_VERSION = "1.2.0";

/** Where that version is written down. Every one of them, or the release lies. */
const VERSION_DECLARATIONS = {
    "package.json": path.join(__dirname, "..", "..", "package.json"),
    "pcf/package.json": path.join(__dirname, "..", "package.json"),
};

/** npm's copy of the same number, written by npm and edited by nobody. */
const LOCK_FILE = path.join(__dirname, "..", "package-lock.json");

interface ExpectedProperty {
    readonly name: string;
    readonly ofType: string;
    /** The declared `default-value`, or `null` where the property declares none. */
    readonly defaultValue: string | null;
}

/**
 * What the manifest has to offer, exactly. Written out rather than derived from
 * the manifest: a test that reads the file to decide what the file should say
 * agrees with every edit, including the wrong ones.
 */
const NOTIFICATION_PROPERTIES: readonly ExpectedProperty[] = [
    { name: "emailEnabled", ofType: "TwoOptions", defaultValue: "false" },
    { name: "emailSubject", ofType: "SingleLine.Text", defaultValue: null },
    { name: "emailBody", ofType: "SingleLine.TextArea", defaultValue: null },
    { name: "emailLinkText", ofType: "SingleLine.Text", defaultValue: null },
    { name: "teamsEnabled", ofType: "TwoOptions", defaultValue: "false" },
    { name: "teamsTitle", ofType: "SingleLine.Text", defaultValue: null },
    { name: "teamsBody", ofType: "SingleLine.TextArea", defaultValue: null },
    { name: "teamsLinkText", ofType: "SingleLine.Text", defaultValue: null },
    { name: "inAppEnabled", ofType: "TwoOptions", defaultValue: "false" },
    { name: "inAppTitle", ofType: "SingleLine.Text", defaultValue: null },
    { name: "inAppBody", ofType: "SingleLine.TextArea", defaultValue: null },
    { name: "inAppLinkText", ofType: "SingleLine.Text", defaultValue: null },
];

/** The three switches, which decide whether a channel is considered at all. */
const CHANNEL_SWITCHES = ["emailEnabled", "teamsEnabled", "inAppEnabled"];

/** Every `<property .../>` in the shipped manifest, as its attributes. */
function declaredProperties(): readonly Readonly<Record<string, string>>[] {
    const tags = manifest.match(/<property\b[^>]*\/>/g) ?? [];

    return tags.map((tag) => {
        const attributes: Record<string, string> = {};
        for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
            const [, key, value] = match;
            if (key !== undefined && value !== undefined) {
                attributes[key] = value;
            }
        }
        return attributes;
    });
}

const properties = declaredProperties();

/** The one declaration of a property, or a failure that names it. */
function declarationOf(name: string): Readonly<Record<string, string>> {
    const found = properties.filter((attributes) => attributes.name === name);
    const [only] = found;
    if (found.length !== 1 || only === undefined) {
        throw new Error(`the manifest declares "${name}" ${String(found.length)} times, expected once`);
    }
    return only;
}

/** Every source file the browser bundle is built from. Generated types excluded. */
function productionSources(): readonly string[] {
    const files: string[] = [];

    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                // Written from the manifest by the build, so of course it names
                // the properties. It is not code anybody wrote.
                if (entry.name !== "generated") {
                    walk(full);
                }
            } else if (/\.tsx?$/.test(entry.name)) {
                files.push(full);
            }
        }
    };

    walk(CONTROL);
    walk(path.join(__dirname, "..", "src"));
    return files;
}

describe("the notification settings a maker configures", () => {
    it("offers all twelve, once each", () => {
        for (const expected of NOTIFICATION_PROPERTIES) {
            const occurrences = properties.filter((attributes) => attributes.name === expected.name).length;
            expect({ property: expected.name, occurrences }).toEqual({ property: expected.name, occurrences: 1 });
        }
    });

    it("declares each one with the type the server was written to read", () => {
        for (const expected of NOTIFICATION_PROPERTIES) {
            const declared = declarationOf(expected.name);
            expect({ property: expected.name, ofType: declared["of-type"] }).toEqual({
                property: expected.name,
                ofType: expected.ofType,
            });
        }
    });

    it("declares every one of them as maker input, not as a bound column", () => {
        // `usage="input"` is what makes a property maker-set rather than tied to
        // a column, and it is what `default-value` is allowed on at all.
        for (const expected of NOTIFICATION_PROPERTIES) {
            const declared = declarationOf(expected.name);
            expect({ property: expected.name, usage: declared.usage }).toEqual({
                property: expected.name,
                usage: "input",
            });
        }
    });

    it("leaves every one of them optional", () => {
        // An imported code component may gain optional properties in a later
        // version but not required ones. A required property here would break
        // every form already using the control.
        for (const expected of NOTIFICATION_PROPERTIES) {
            const declared = declarationOf(expected.name);
            expect({ property: expected.name, required: declared.required }).toEqual({
                property: expected.name,
                required: "false",
            });
        }
    });

    it("starts every channel switched off", () => {
        // A form configured before these properties existed, or configured and
        // left alone, must not start notifying anybody.
        for (const name of CHANNEL_SWITCHES) {
            const declared = declarationOf(name);
            expect({ property: name, default: declared["default-value"] }).toEqual({
                property: name,
                default: "false",
            });
        }
    });

    it("requires no message text in the manifest", () => {
        // "A subject is required when e-mail is on" is a conditional rule. The
        // manifest cannot express it, the server has to check it anyway, and a
        // rule enforced in two places is enforced differently in two places.
        for (const expected of NOTIFICATION_PROPERTIES) {
            if (CHANNEL_SWITCHES.includes(expected.name)) {
                continue;
            }
            expect(declarationOf(expected.name).required).toBe("false");
        }
    });

    it("declares a default only where a default means something", () => {
        for (const expected of NOTIFICATION_PROPERTIES) {
            const declared = declarationOf(expected.name);
            expect({ property: expected.name, default: declared["default-value"] ?? null }).toEqual({
                property: expected.name,
                default: expected.defaultValue,
            });
        }
    });
});

describe("what the control does with those settings", () => {
    it("does not read them", () => {
        // The whole point of resolving configuration on the server: a value that
        // reached the browser is a claim, and a claim must not decide who gets a
        // message or what it says. The control never touches these, so it cannot
        // put them anywhere either.
        const offenders: string[] = [];

        for (const file of productionSources()) {
            const source = fs.readFileSync(file, "utf8");
            for (const expected of NOTIFICATION_PROPERTIES) {
                if (source.includes(expected.name)) {
                    offenders.push(`${path.basename(file)} names ${expected.name}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it("still writes only the bound text and its companion metadata", () => {
        // The bound outputs are the commit boundary. Adding a configuration
        // surface must not add a third thing that travels with the save.
        const bound = properties
            .filter((attributes) => attributes.usage === "bound")
            .map((attributes) => attributes.name);

        expect(bound.sort()).toEqual(["field", "mentionMetadata"]);
    });

    it("leaves the companion metadata column exactly as it was", () => {
        const declared = declarationOf("mentionMetadata");

        expect({
            usage: declared.usage,
            ofType: declared["of-type"],
            required: declared.required,
            default: declared["default-value"] ?? null,
        }).toEqual({ usage: "bound", ofType: "Multiple", required: "true", default: null });
    });

    it("declares no output property that could carry them off the form", () => {
        expect(properties.filter((attributes) => attributes.usage === "output")).toEqual([]);
    });
});

describe("the strings a maker reads while configuring them", () => {
    const english = readResources("1033");
    const german = readResources("1031");

    it("names each property in both languages", () => {
        for (const expected of NOTIFICATION_PROPERTIES) {
            const declared = declarationOf(expected.name);
            for (const key of [declared["display-name-key"], declared["description-key"]]) {
                expect({ property: expected.name, key, shipped: key !== undefined }).toEqual({
                    property: expected.name,
                    key,
                    shipped: true,
                });
                expect((english.get(key ?? "") ?? "").length).toBeGreaterThan(0);
                expect((german.get(key ?? "") ?? "").length).toBeGreaterThan(0);
            }
        }
    });

    it("translates the descriptions rather than copying them", () => {
        for (const expected of NOTIFICATION_PROPERTIES) {
            const key = declarationOf(expected.name)["description-key"] ?? "";
            expect(german.get(key)).not.toBe(english.get(key));
        }
    });
});

describe("the version this adds up to", () => {
    it("is a minor version, because this only adds optional properties", () => {
        const declared = /<control\b[^>]*?\bversion="([^"]*)"/.exec(manifest)?.[1];
        expect(declared).toBe(CONTROL_VERSION);
    });

    it("says the same number in every file that declares it", () => {
        for (const [where, file] of Object.entries(VERSION_DECLARATIONS)) {
            const declared: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
            const version = (declared as { version?: unknown }).version;
            expect({ where, version }).toEqual({ where, version: CONTROL_VERSION });
        }
    });

    it("says it in the lock file too, in both places npm writes it", () => {
        // Raising the version in package.json does not touch the lock file, and
        // `npm ci` installs from the lock file without rewriting it — so a stale
        // number here survives the build, the release checker and every other
        // check, because none of them reads it. It is generated project
        // metadata rather than a version authority, which is exactly why nothing
        // else notices when it drifts.
        const lock: unknown = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
        const { version, packages } = lock as {
            version?: unknown;
            packages?: Record<string, { version?: unknown } | undefined>;
        };

        expect({ where: "top level", version }).toEqual({ where: "top level", version: CONTROL_VERSION });
        expect({ where: 'packages[""]', version: packages?.[""]?.version }).toEqual({
            where: 'packages[""]',
            version: CONTROL_VERSION,
        });
    });
});
