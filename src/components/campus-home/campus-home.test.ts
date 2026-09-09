import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  CampusHomePublicationCard,
  CampusHomePublicationDetail,
} from "@/application/content/campus-home";

import { CampusHomeErrorState, CampusHomeUnavailableState } from "./home-states";
import { CampusHomePage } from "./campus-home-page";
import { PublicationCard } from "./publication-card";
import { PublicationDetail } from "./publication-detail";
import { PublicationFeed } from "./publication-feed";

const publication: CampusHomePublicationCard = {
  id: "00000000-0000-4000-8000-000000000021",
  type: "notice",
  priority: "priority",
  title: "Registration notice",
  excerpt: "Registration closes on Friday.",
  authorOfficeLabel: "Registrar",
  publishedAt: new Date("2026-01-10T12:00:00.000Z"),
  publishedAtLabel: "10 Jan 2026, 15:00",
};

describe("Campus Home presentation", () => {
  it("renders Notice and Priority semantics as an accessible linked card", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationCard, { publication }),
    );

    expect(html).toContain("Notice");
    expect(html).toContain("Priority");
    expect(html).toContain("Registration notice");
    expect(html).toContain(
      "href=\"/publications/00000000-0000-4000-8000-000000000021\"",
    );
    expect(html).toContain("<time");
  });

  it("renders News, multiple cards, and a keyset Load more link", () => {
    const news = {
      ...publication,
      type: "news" as const,
      priority: "standard" as const,
      id: "00000000-0000-4000-8000-000000000022",
      title: "Campus news",
    };
    const html = renderToStaticMarkup(
      createElement(PublicationFeed, {
        items: [publication, news],
        nextCursor: "cursor-value",
      }),
    );

    expect(html).toContain("Campus news");
    expect(html).toContain("Campus publications");
    expect(html).toContain("Load more");
    expect(html).toContain("/?cursor=cursor-value");
  });

  it("renders the calm empty state without hidden-content metadata", () => {
    const html = renderToStaticMarkup(
      createElement(PublicationFeed, { items: [], nextCursor: null }),
    );

    expect(html).toContain("Nothing new has been published for you yet.");
    expect(html).not.toContain("hidden");
  });

  it("renders the Home heading and safe generic states", () => {
    const homeHtml = renderToStaticMarkup(
      createElement(CampusHomePage, {
        tenantDisplayName: "Campus A",
        items: [publication],
        nextCursor: null,
      }),
    );
    const unavailableHtml = renderToStaticMarkup(
      createElement(CampusHomeUnavailableState),
    );
    const errorHtml = renderToStaticMarkup(createElement(CampusHomeErrorState));

    expect(homeHtml).toContain("Campus Home");
    expect(homeHtml).toContain("Campus A");
    expect(unavailableHtml).toContain("trusted campus context");
    expect(errorHtml).toContain("We couldn’t load your campus updates.");
    expect(errorHtml).not.toContain("database");
  });

  it("renders authorized detail content with a return link", () => {
    const detail: CampusHomePublicationDetail = {
      ...publication,
      body: "Full notice body.",
    };
    const html = renderToStaticMarkup(
      createElement(PublicationDetail, { publication: detail }),
    );

    expect(html).toContain("Full notice body.");
    expect(html).toContain("Back to Campus Home");
    expect(html).toContain("href=\"/\"");
  });
});
