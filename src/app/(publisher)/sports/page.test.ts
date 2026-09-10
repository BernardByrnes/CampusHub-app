import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SportsManagementPage } from "@/components/sports/sports-management-page";

describe("Publisher Sports management surface", () => {
  it("does not expose controls without a server-produced trusted context", () => {
    const html = renderToStaticMarkup(createElement(SportsManagementPage));

    expect(html).toContain("Sports management");
    expect(html).toContain("server-produced trusted Publisher context");
    expect(html).toContain("does not accept identity, Tenant, or capability values");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("identitySubjectId");
  });
});
