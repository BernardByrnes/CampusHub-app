import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TransparencyPage } from "./transparency-page";

describe("Transparency page presentation", () => {
  it("renders without a RequestContext or authentication input", () => {
    const html = renderToStaticMarkup(createElement(TransparencyPage));

    expect(html).toContain("<main");
    expect(html).toContain("What CampusHub does with information");
    expect(html).not.toContain("RequestContext");
    expect(html).not.toContain("Sign in");
  });

  it("renders one clear heading, semantic sections, and visible navigation", () => {
    const html = renderToStaticMarkup(createElement(TransparencyPage));

    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect((html.match(/<h2/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('href="#poll-privacy"');
    expect(html).toContain('href="#your-data-rights"');
    expect(html).toContain('href="#current-build"');
  });

  it("keeps important current-status information visible without accordions", () => {
    const html = renderToStaticMarkup(createElement(TransparencyPage));

    expect(html).toContain("Polls are not yet enabled in this build.");
    expect(html).toContain("Student Voice is not enabled in this build.");
    expect(html).toContain("Sponsors do not receive personal student data");
    expect(html).toContain("Not yet enabled");
    expect(html).not.toContain("<details");
  });

  it("uses meaningful text links and focus-visible affordances", () => {
    const html = renderToStaticMarkup(createElement(TransparencyPage));

    expect(html).toContain("underline-offset-4");
    expect(html).toContain("focus-visible:outline");
    expect(html).toContain("Your data rights");
    expect(html).toContain("Tenant-specific details");
  });
});
