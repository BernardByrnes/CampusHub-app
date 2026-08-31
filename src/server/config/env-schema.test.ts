import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env-schema";

describe("server environment validation", () => {
  it("rejects missing DATABASE_URL", () => {
    expect(() => parseServerEnv({ NODE_ENV: "test" })).toThrow();
  });

  it("rejects non-PostgreSQL connection URLs", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: "https://example.invalid/database",
        NODE_ENV: "test",
      }),
    ).toThrow();
  });

  it("accepts a PostgreSQL URL and defaults NODE_ENV", () => {
    expect(
      parseServerEnv({
        DATABASE_URL: "postgresql://user:placeholder@localhost:5432/campushub",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://user:placeholder@localhost:5432/campushub",
      NODE_ENV: "development",
    });
  });
});
