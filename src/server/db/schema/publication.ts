import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { RESOURCE_VISIBILITIES } from "@/domain/authorization/resource-visibility";
import {
  PUBLICATION_LIFECYCLES,
  PUBLICATION_AUDIENCE_MODES,
  PUBLICATION_PRIORITIES,
  PUBLICATION_TYPES,
} from "@/domain/content/publication";

import { tenants } from "./tenant";

export const publicationTypeEnum = pgEnum("publication_type", PUBLICATION_TYPES);

export const publicationPriorityEnum = pgEnum(
  "publication_priority",
  PUBLICATION_PRIORITIES,
);

export const publicationLifecycleEnum = pgEnum(
  "publication_lifecycle",
  PUBLICATION_LIFECYCLES,
);

export const publicationVisibilityEnum = pgEnum(
  "publication_visibility",
  RESOURCE_VISIBILITIES,
);

export const publicationAudienceModeEnum = pgEnum(
  "publication_audience_mode",
  PUBLICATION_AUDIENCE_MODES,
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: publicationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: publicationPriorityEnum("priority")
      .notNull()
      .default("standard"),
    visibility: publicationVisibilityEnum("visibility")
      .notNull()
      .default("MEMBERS"),
    lifecycle: publicationLifecycleEnum("lifecycle")
      .notNull()
      .default("draft"),
    audienceMode: publicationAudienceModeEnum("audience_mode").notNull(),
    authorOfficeLabel: text("author_office_label").notNull(),
    publishAt: timestamp("publish_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }),
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
    index("publications_tenant_id_id").on(table.tenantId, table.id),
    index("publications_tenant_lifecycle").on(
      table.tenantId,
      table.lifecycle,
    ),
    index("publications_tenant_collection_order").on(
      table.tenantId,
      table.audienceMode,
      table.lifecycle,
      table.publishAt,
      table.id,
    ),
    check(
      "publications_title_nonempty",
      sql`char_length(btrim(${table.title})) > 0`,
    ),
    check(
      "publications_body_nonempty",
      sql`char_length(btrim(${table.body})) > 0`,
    ),
    check(
      "publications_author_office_label_nonempty",
      sql`char_length(btrim(${table.authorOfficeLabel})) > 0`,
    ),
  ],
);

export type PublicationRow = typeof publications.$inferSelect;
export type NewPublicationRow = typeof publications.$inferInsert;
