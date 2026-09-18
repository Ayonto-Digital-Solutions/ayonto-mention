import * as fs from "fs";
import * as path from "path";

import { AyontoMentionControl } from "../MentionControl/index";

/**
 * Who this component says it is.
 *
 * It shares its environments — and its publisher — with the productive legacy
 * mention control, and the two are not versions of one another: this one needs a
 * record id, a table name and a companion column that the legacy contract has no
 * place for. A code component may gain optional properties in a later version but
 * not required ones, so the two have to be two components, and the only thing
 * keeping them apart is the name in the manifest.
 *
 * That name is easy to change back by accident — a rename, a merge, a copied
 * block — and the mistake would not show up until an import in a real
 * environment replaced a control that forms are already using. So it is written
 * down here, as a fact about the shipped manifest rather than about a constant
 * somebody could edit alongside the code.
 */

const NAMESPACE = "Ayonto";
const CONSTRUCTOR = "AyontoMentionControl";
/** The productive legacy control. This component must never be it. */
const LEGACY_CONSTRUCTOR = "MentionControl";

const manifest = fs.readFileSync(
    path.join(__dirname, "..", "MentionControl", "ControlManifest.Input.xml"),
    "utf8"
);

const attribute = (name: string): string | undefined =>
    new RegExp(`<control\\b[^>]*?\\b${name}="([^"]*)"`).exec(manifest)?.[1];

describe("the identity this component ships under", () => {
    it("is Ayonto.AyontoMentionControl", () => {
        expect(attribute("namespace")).toBe(NAMESPACE);
        expect(attribute("constructor")).toBe(CONSTRUCTOR);
    });

    it("is not the legacy control", () => {
        // The whole point: `Ayonto.MentionControl` belongs to something else that
        // is in use, and importing over it would take that away from the people
        // using it.
        expect(attribute("constructor")).not.toBe(LEGACY_CONSTRUCTOR);
        expect(`${NAMESPACE}.${CONSTRUCTOR}`).not.toBe(`${NAMESPACE}.${LEGACY_CONSTRUCTOR}`);
    });

    it("names a class the platform can actually construct", () => {
        // The manifest's constructor is the name of the exported class; a rename
        // on one side and not the other builds cleanly and fails at runtime.
        expect(AyontoMentionControl.name).toBe(CONSTRUCTOR);
        expect(typeof new AyontoMentionControl().updateView).toBe("function");
    });

    it("carries the version this release is cut for", () => {
        expect(attribute("version")).toBe("1.2.0");
    });

    it("still asks for what the legacy contract has no place for", () => {
        // These are why the two cannot be one component, so a version that
        // quietly dropped them would also quietly remove the reason for the
        // separate name.
        for (const property of ["recordId", "recordTable", "mentionMetadata"]) {
            const declared = new RegExp(
                `<property\\b[^>]*?\\bname="${property}"[^>]*?\\brequired="true"`
            ).test(manifest);
            expect({ property, required: declared }).toEqual({ property, required: true });
        }
    });
});
