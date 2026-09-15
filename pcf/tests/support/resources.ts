import * as fs from "node:fs";
import * as path from "node:path";

/** The resource files the control actually ships, by language code. */
export const RESOURCE_FILES: Readonly<Record<string, string>> = {
    "1033": path.join(__dirname, "..", "..", "MentionControl", "strings", "MentionControl.1033.resx"),
    "1031": path.join(__dirname, "..", "..", "MentionControl", "strings", "MentionControl.1031.resx"),
};

/**
 * Reads one shipped resource file.
 *
 * The real file, not a copy: a test that asserts against a transcription proves
 * only that the transcription is consistent with itself.
 */
export function readResources(language: keyof typeof RESOURCE_FILES): ReadonlyMap<string, string> {
    const file = RESOURCE_FILES[language];
    if (file === undefined) {
        throw new Error(`no resource file for language ${language}`);
    }
    const xml = fs.readFileSync(file, "utf8");
    const entries = new Map<string, string>();
    const pattern = /<data name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g;

    for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
        const [, name, value] = match;
        if (name !== undefined && value !== undefined) {
            entries.set(name, value);
        }
    }

    return entries;
}

const english = readResources("1033");

/**
 * Answers a resource lookup the way the platform would, from the shipped English
 * file — and refuses a key that is not in it, so a control asking for a string it
 * never shipped fails the test instead of rendering an identifier to a user.
 */
export function resourceValue(id: string): string {
    const value = english.get(id);
    if (value === undefined) {
        throw new Error(`the control asked for resource "${id}", which is not shipped`);
    }
    return value;
}
