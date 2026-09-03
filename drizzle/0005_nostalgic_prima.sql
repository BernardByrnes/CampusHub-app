CREATE TYPE "public"."academic_division_lifecycle" AS ENUM('active', 'inactive', 'merged');--> statement-breakpoint
CREATE TYPE "public"."campus_lifecycle" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."programme_lifecycle" AS ENUM('active', 'inactive', 'merged');--> statement-breakpoint
CREATE TYPE "public"."residence_lifecycle" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "academic_divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"parent_academic_division_id" uuid,
	"level" integer DEFAULT 1 NOT NULL,
	"status" "academic_division_lifecycle" DEFAULT 'active' NOT NULL,
	"merged_into_academic_division_id" uuid,
	"merged_effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_divisions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "academic_divisions_label_nonempty" CHECK (char_length(btrim("academic_divisions"."label")) > 0),
	CONSTRAINT "academic_divisions_level_valid" CHECK ("academic_divisions"."level" IN (1, 2)),
	CONSTRAINT "academic_divisions_level_parent_shape" CHECK (("academic_divisions"."level" = 1 AND "academic_divisions"."parent_academic_division_id" IS NULL) OR ("academic_divisions"."level" = 2 AND "academic_divisions"."parent_academic_division_id" IS NOT NULL)),
	CONSTRAINT "academic_divisions_parent_not_self" CHECK ("academic_divisions"."parent_academic_division_id" IS NULL OR "academic_divisions"."parent_academic_division_id" <> "academic_divisions"."id"),
	CONSTRAINT "academic_divisions_merge_not_self" CHECK ("academic_divisions"."merged_into_academic_division_id" IS NULL OR "academic_divisions"."merged_into_academic_division_id" <> "academic_divisions"."id"),
	CONSTRAINT "academic_divisions_merge_metadata_shape" CHECK (("academic_divisions"."status" = 'merged' AND "academic_divisions"."merged_into_academic_division_id" IS NOT NULL AND "academic_divisions"."merged_effective_at" IS NOT NULL) OR ("academic_divisions"."status" <> 'merged' AND "academic_divisions"."merged_into_academic_division_id" IS NULL AND "academic_divisions"."merged_effective_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "campus_lifecycle" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campuses_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "campuses_label_nonempty" CHECK (char_length(btrim("campuses"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"academic_division_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "programme_lifecycle" DEFAULT 'active' NOT NULL,
	"merged_into_programme_id" uuid,
	"merged_effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programmes_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "programmes_label_nonempty" CHECK (char_length(btrim("programmes"."label")) > 0),
	CONSTRAINT "programmes_merge_not_self" CHECK ("programmes"."merged_into_programme_id" IS NULL OR "programmes"."merged_into_programme_id" <> "programmes"."id"),
	CONSTRAINT "programmes_merge_metadata_shape" CHECK (("programmes"."status" = 'merged' AND "programmes"."merged_into_programme_id" IS NOT NULL AND "programmes"."merged_effective_at" IS NOT NULL) OR ("programmes"."status" <> 'merged' AND "programmes"."merged_into_programme_id" IS NULL AND "programmes"."merged_effective_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "residences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "residence_lifecycle" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "residences_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "residences_label_nonempty" CHECK (char_length(btrim("residences"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_academic_year_config" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"minimum_year" integer NOT NULL,
	"maximum_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_academic_year_config_minimum_positive" CHECK ("tenant_academic_year_config"."minimum_year" >= 1),
	CONSTRAINT "tenant_academic_year_config_range_valid" CHECK ("tenant_academic_year_config"."maximum_year" >= "tenant_academic_year_config"."minimum_year")
);
--> statement-breakpoint
ALTER TABLE "academic_divisions" ADD CONSTRAINT "academic_divisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "academic_divisions" ADD CONSTRAINT "academic_divisions_parent_same_tenant_fk" FOREIGN KEY ("tenant_id","parent_academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "academic_divisions" ADD CONSTRAINT "academic_divisions_merge_same_tenant_fk" FOREIGN KEY ("tenant_id","merged_into_academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_division_same_tenant_fk" FOREIGN KEY ("tenant_id","academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_merge_same_tenant_fk" FOREIGN KEY ("tenant_id","merged_into_programme_id") REFERENCES "public"."programmes"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "residences" ADD CONSTRAINT "residences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tenant_academic_year_config" ADD CONSTRAINT "tenant_academic_year_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "academic_divisions_tenant_parent" ON "academic_divisions" USING btree ("tenant_id","parent_academic_division_id");--> statement-breakpoint
CREATE INDEX "academic_divisions_tenant_status" ON "academic_divisions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "campuses_tenant_status" ON "campuses" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "programmes_tenant_division" ON "programmes" USING btree ("tenant_id","academic_division_id");--> statement-breakpoint
CREATE INDEX "programmes_tenant_status" ON "programmes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "residences_tenant_status" ON "residences" USING btree ("tenant_id","status");