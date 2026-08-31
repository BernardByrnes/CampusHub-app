import { describe, expect, it } from "vitest";

import { getHealth } from "./get-health";

describe("getHealth", () => {
  it("returns only the safe application liveness shape", () => {
    expect(getHealth()).toEqual({ status: "ok" });
  });
});
