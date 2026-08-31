/**
 * Business tables are intentionally deferred from 8V-B.0.
 *
 * Tenant, Membership, XP, Streak, and Poll persistence arrive in later,
 * authority-gated phases. Keeping this module as the schema boundary lets
 * Drizzle tooling be configured without inventing product migrations.
 */
export {};
