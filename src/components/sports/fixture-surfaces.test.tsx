import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentFixturesPage } from "./fixture-surfaces";

const date = new Date("2026-09-10T12:00:00.000Z");
const item = (state: "scheduled" | "postponed" | "cancelled" | "completed" | "abandoned") => ({
  fixture: {
    id: state,
    tenantId: "00000000-0000-4000-8000-000000000001",
    competitionId: "00000000-0000-4000-8000-000000000002",
    homeTeamId: "00000000-0000-4000-8000-000000000003",
    awayTeamId: "00000000-0000-4000-8000-000000000004",
    campusId: "00000000-0000-4000-8000-000000000005",
    startsAt: date,
    venue: "Main pitch",
    state,
    reason: state === "scheduled" || state === "completed" ? null : "Weather",
    version: 1,
    createdAt: date,
    updatedAt: date,
  },
  sportName: "Football",
  competitionName: "Campus League",
  homeTeamName: "Campus United",
  awayTeamName: "Rivals",
  campusLabel: "Main Campus",
});

describe("Student Fixture surface", () => {
  it("renders bounded filters, matchups, and all closed states without scores or Follow", () => {
    const html = renderToStaticMarkup(
      <StudentFixturesPage items={[
        item("scheduled"),
        item("postponed"),
        item("cancelled"),
        item("completed"),
        item("abandoned"),
      ]} />,
    );
    expect(html).toContain("Fixtures");
    expect(html).toContain("Campus United");
    expect(html).toContain("State: Scheduled");
    expect(html).toContain("State: Postponed");
    expect(html).toContain("State: Cancelled");
    expect(html).toContain("State: Completed");
    expect(html).toContain("State: Abandoned");
    expect(html).toContain("name=\"sport\"");
    expect(html).toContain("name=\"competition\"");
    expect(html).toContain("name=\"team\"");
    expect(html).not.toContain("Follow");
    expect(html).not.toContain("Score");
  });
});
