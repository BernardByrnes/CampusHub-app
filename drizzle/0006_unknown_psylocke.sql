CREATE TYPE "public"."membership_residence_state" AS ENUM('unknown', 'non_resident', 'resident');--> statement-breakpoint
CREATE TYPE "public"."profile_field_provenance" AS ENUM('institution_verified', 'roster_derived', 'self_declared', 'optional');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "campus_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "campus_provenance" "profile_field_provenance";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "academic_division_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "academic_division_provenance" "profile_field_provenance" DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "programme_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "programme_provenance" "profile_field_provenance" DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "academic_year" integer;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "academic_year_provenance" "profile_field_provenance" DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "residence_state" "membership_residence_state" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "residence_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "residence_provenance" "profile_field_provenance" DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_tenant_id_id_division_unique" UNIQUE("tenant_id","id","academic_division_id");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_academic_division_same_tenant_fk" FOREIGN KEY ("tenant_id","academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_programme_division_same_tenant_fk" FOREIGN KEY ("tenant_id","programme_id","academic_division_id") REFERENCES "public"."programmes"("tenant_id","id","academic_division_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_residence_same_tenant_fk" FOREIGN KEY ("tenant_id","residence_id") REFERENCES "public"."residences"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_campus_provenance_shape" CHECK (("memberships"."campus_id" IS NULL AND "memberships"."campus_provenance" IS NULL) OR ("memberships"."campus_id" IS NOT NULL AND "memberships"."campus_provenance" IS NOT NULL AND "memberships"."campus_provenance" IN ('institution_verified', 'roster_derived', 'self_declared')));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_academic_division_provenance_shape" CHECK (("memberships"."academic_division_id" IS NULL AND "memberships"."academic_division_provenance" = 'optional') OR ("memberships"."academic_division_id" IS NOT NULL AND "memberships"."academic_division_provenance" <> 'optional'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_programme_provenance_shape" CHECK (("memberships"."programme_id" IS NULL AND "memberships"."programme_provenance" = 'optional') OR ("memberships"."programme_id" IS NOT NULL AND "memberships"."programme_provenance" <> 'optional'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_academic_year_provenance_shape" CHECK (("memberships"."academic_year" IS NULL AND "memberships"."academic_year_provenance" = 'optional') OR ("memberships"."academic_year" IS NOT NULL AND "memberships"."academic_year_provenance" <> 'optional'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_academic_year_positive" CHECK ("memberships"."academic_year" IS NULL OR "memberships"."academic_year" >= 1);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_programme_requires_division" CHECK ("memberships"."programme_id" IS NULL OR "memberships"."academic_division_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_residence_shape" CHECK (("memberships"."residence_state" = 'unknown' AND "memberships"."residence_id" IS NULL AND "memberships"."residence_provenance" = 'optional') OR ("memberships"."residence_state" = 'non_resident' AND "memberships"."residence_id" IS NULL AND "memberships"."residence_provenance" <> 'optional') OR ("memberships"."residence_state" = 'resident' AND "memberships"."residence_id" IS NOT NULL AND "memberships"."residence_provenance" <> 'optional'));
