import { describe, expect, it } from "vitest";

import type { TransparencyContent } from "./transparency-content";
import { transparencyContent } from "./transparency-content";

const sections: TransparencyContent["sections"] = transparencyContent.sections;

const allCopy = [
  transparencyContent.introduction,
  ...sections.flatMap((section) => [
    section.eyebrow,
    section.title,
    ...section.paragraphs,
    ...(section.bullets ?? []),
    ...(section.note === undefined
      ? []
      : [section.note.label, section.note.text]),
  ]),
  transparencyContent.currentBuild.eyebrow,
  transparencyContent.currentBuild.title,
  transparencyContent.currentBuild.introduction,
  ...transparencyContent.currentBuild.enabled.flatMap((item) => [
    item.title,
    item.detail,
  ]),
  ...transparencyContent.currentBuild.notEnabled.flatMap((item) => [
    item.title,
    item.detail,
  ]),
  transparencyContent.tenantSpecific.eyebrow,
  transparencyContent.tenantSpecific.title,
  transparencyContent.tenantSpecific.text,
  transparencyContent.closing,
].join(" ");

describe("transparency content governance", () => {
  it("has distinct major sections and an explicit current-build status model", () => {
    const ids = transparencyContent.sections.map((section) => section.id);

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(transparencyContent.currentBuild.enabled.length).toBeGreaterThan(0);
    expect(transparencyContent.currentBuild.notEnabled.length).toBeGreaterThan(0);
    expect(transparencyContent.tenantSpecific.text).toContain(
      "does not invent a public Tenant selector",
    );
  });

  it("states the current Poll and Student Voice boundaries without future guarantees", () => {
    expect(allCopy).toContain(
      "Polls are not yet enabled in this build. CampusHub will not launch Poll participation until its privacy and storage design has completed the required review.",
    );
    expect(allCopy).toContain("Student Voice is not enabled in this build.");
    expect(allCopy).toContain("pseudonymous to peers");
    expect(allCopy).toContain("A1/OD-11 remains unresolved");
  });

  it("preserves sponsor, audit, retention, and rights boundaries", () => {
    expect(allCopy).toContain("Sponsors do not receive personal student data");
    expect(allCopy).toContain("behavioural targeting is prohibited");
    expect(allCopy).toContain("immutable audit history");
    expect(allCopy).toContain("cannot be remotely erased");
    expect(allCopy).toContain("Formal request workflows will be published before the first real CampusHub Pilot");
    expect(allCopy).toContain("not a final legal rights notice");
  });

  it("does not make unsupported privacy, legal, or sponsor-data claims", () => {
    expect(allCopy).not.toMatch(/anonymous polls/i);
    expect(allCopy).not.toMatch(/completely anonymous/i);
    expect(allCopy).not.toMatch(/fully unlinkable/i);
    expect(allCopy).not.toMatch(/GDPR compliant/i);
    expect(allCopy).not.toMatch(/legal(?:ly)? approved/i);
    expect(allCopy).not.toMatch(/sponsors (?:receive|can access) (?:personal )?student contact data/i);
  });
});
