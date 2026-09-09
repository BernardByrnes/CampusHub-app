export type AuditIntegrityKeyMaterial = Readonly<{
  keyVersion: number;
  key: Uint8Array;
}>;

export interface AuditIntegrityKeyProvider {
  getActiveSigningKey(): AuditIntegrityKeyMaterial | null;
  getVerificationKey(keyVersion: number): Uint8Array | null;
}

type KeyEnvironment = Readonly<Record<string, string | undefined>>;

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function decodeBase64Key(value: string | undefined): Uint8Array | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  try {
    const decoded = Buffer.from(value.trim(), "base64");
    if (decoded.length < 32) {
      return null;
    }
    return new Uint8Array(decoded);
  } catch {
    return null;
  }
}

/**
 * Production wiring boundary. It accepts externally supplied configuration,
 * but never invents a key or treats a key version as key material.
 */
export class EnvironmentAuditIntegrityKeyProvider
  implements AuditIntegrityKeyProvider
{
  private readonly active: AuditIntegrityKeyMaterial | null;

  public constructor(environment: KeyEnvironment = process.env) {
    const keyVersion = parsePositiveInteger(
      environment.AUDIT_INTEGRITY_KEY_VERSION,
    );
    const key = decodeBase64Key(environment.AUDIT_INTEGRITY_KEY);
    this.active =
      keyVersion !== null && key !== null ? { keyVersion, key } : null;
  }

  public getActiveSigningKey(): AuditIntegrityKeyMaterial | null {
    return this.active;
  }

  public getVerificationKey(keyVersion: number): Uint8Array | null {
    return this.active?.keyVersion === keyVersion ? this.active.key : null;
  }
}

/** Explicit test-only key provider; no production default is supplied. */
export class StaticAuditIntegrityKeyProvider
  implements AuditIntegrityKeyProvider
{
  private readonly keys: ReadonlyMap<number, Uint8Array>;
  private readonly activeKeyVersion: number;

  public constructor(
    activeKeyVersion: number,
    keys: ReadonlyMap<number, Uint8Array> | Record<number, Uint8Array>,
  ) {
    this.activeKeyVersion = activeKeyVersion;
    this.keys =
      keys instanceof Map
        ? new Map(keys)
        : new Map(
            Object.entries(keys).map(([version, key]) => [Number(version), key]),
          );
  }

  public getActiveSigningKey(): AuditIntegrityKeyMaterial | null {
    const key = this.keys.get(this.activeKeyVersion);
    return key === undefined
      ? null
      : { keyVersion: this.activeKeyVersion, key };
  }

  public getVerificationKey(keyVersion: number): Uint8Array | null {
    return this.keys.get(keyVersion) ?? null;
  }
}
