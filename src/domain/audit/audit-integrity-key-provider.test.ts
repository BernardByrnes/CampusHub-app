import { describe, expect, it } from "vitest";

import {
  EnvironmentAuditIntegrityKeyProvider,
  StaticAuditIntegrityKeyProvider,
} from "./audit-integrity-key-provider";

const key = new Uint8Array(Buffer.from("campushub-audit-provider-test-key"));
const historicalKey = new Uint8Array(
  Buffer.from("campushub-audit-provider-historical-key"),
);

describe("audit integrity key providers", () => {
  it("loads only an explicitly configured external key and version", () => {
    const provider = new EnvironmentAuditIntegrityKeyProvider({
      AUDIT_INTEGRITY_KEY: Buffer.from(key).toString("base64"),
      AUDIT_INTEGRITY_KEY_VERSION: "3",
    });

    expect(provider.getActiveSigningKey()).toEqual({ keyVersion: 3, key });
    expect(provider.getVerificationKey(3)).toEqual(key);
    expect(provider.getVerificationKey(2)).toBeNull();
  });

  it("fails closed when configuration is absent or invalid", () => {
    for (const environment of [
      {},
      { AUDIT_INTEGRITY_KEY: "not-base64", AUDIT_INTEGRITY_KEY_VERSION: "1" },
      {
        AUDIT_INTEGRITY_KEY: Buffer.from(key).toString("base64"),
        AUDIT_INTEGRITY_KEY_VERSION: "0",
      },
    ]) {
      const provider = new EnvironmentAuditIntegrityKeyProvider(environment);
      expect(provider.getActiveSigningKey()).toBeNull();
      expect(provider.getVerificationKey(1)).toBeNull();
    }
  });

  it("supports explicit test keys without a production default", () => {
    const provider = new StaticAuditIntegrityKeyProvider(
      1,
      new Map([[1, key]]),
    );
    expect(provider.getActiveSigningKey()).toEqual({ keyVersion: 1, key });
    expect(provider.getVerificationKey(1)).toEqual(key);
  });

  it("retains configured historical verification keys alongside the active key", () => {
    const provider = new EnvironmentAuditIntegrityKeyProvider({
      AUDIT_INTEGRITY_KEY: Buffer.from(key).toString("base64"),
      AUDIT_INTEGRITY_KEY_VERSION: "3",
      AUDIT_INTEGRITY_KEYRING: JSON.stringify({
        2: Buffer.from(historicalKey).toString("base64"),
      }),
    });

    expect(provider.getActiveSigningKey()).toEqual({ keyVersion: 3, key });
    expect(provider.getVerificationKey(2)).toEqual(historicalKey);
    expect(provider.getVerificationKey(3)).toEqual(key);
  });
});
