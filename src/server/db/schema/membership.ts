import { sql } from "drizzle-orm";
import {
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ASSURANCE_LEVELS } from "@/domain/authorization/assurance-level";
import { MEMBERSHIP_LIFECYCLE_STATUSES } from "@/domain/membership/membership";

import { tenants } from "./tenant";

export const membershipAssuranceLevelEnum = pgEnum(
  "membership_assurance_level",
  ASSURANCE_LEVELS,
);

export const membershipLifecycleEnum = pgEnum(
  "membership_lifecycle",
  MEMBERSHIP_LIFECYCLE_STATUSES,
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    /** Opaque future-auth subject; never a provider-specific user foreign key. */
    identitySubjectId: text("identity_subject_id").notNull(),
    assuranceLevel: membershipAssuranceLevelEnum("assurance_level")
      .notNull()
      .default("L0"),
    lifecycle: membershipLifecycleEnum("lifecycle")
      .notNull()
      .default("unverified"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_tenant_identity_unique").on(
      table.tenantId,
      table.identitySubjectId,
    ),
    check(
      "memberships_identity_subject_nonempty",
      sql`char_length(btrim(${table.identitySubjectId})) > 0`,
    ),
  ],
);

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembershipRow = typeof memberships.$inferInsert;
