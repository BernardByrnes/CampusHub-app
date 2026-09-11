import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PublisherFixturesManagementPage } from "@/components/sports/fixture-surfaces";

describe("Publisher Fixture management surface", () => {
  it("does not expose controls without trusted Publisher context", () => {
    const html = renderToStaticMarkup(createElement(PublisherFixturesManagementPage));
    expect(html).toContain("Fixture management");
    expect(html).toContain("server-produced trusted Publisher context");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("identitySubjectId");
  });
});
