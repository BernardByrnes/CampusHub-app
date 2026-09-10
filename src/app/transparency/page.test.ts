import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TransparencyRoute, { metadata } from "./page";

describe("public Transparency route", () => {
  it("renders for an unauthenticated visitor", () => {
    const html = renderToStaticMarkup(createElement(TransparencyRoute));

    expect(html).toContain("Student transparency");
    expect(html).toContain("What CampusHub does with information");
  });

  it("has descriptive metadata without defining an indexing policy", () => {
    expect(metadata).toEqual({
      title: "Transparency | CampusHub",
      description: "Plain-language information about CampusHub and student data.",
    });
    expect(metadata).not.toHaveProperty("robots");
  });
});
