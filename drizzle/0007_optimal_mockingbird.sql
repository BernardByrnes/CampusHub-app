CREATE TYPE "public"."publication_audience_dimension" AS ENUM('campus', 'academic_division', 'programme', 'academic_year', 'residence');--> statement-breakpoint
CREATE TYPE "public"."publication_audience_provenance_policy" AS ENUM('authoritative_only', 'allow_self_declared');--> statement-breakpoint
CREATE TYPE "public"."publication_audience_residence_target" AS ENUM('specific_residence', 'any_resident', 'non_resident');--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "publication_audience_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"dimension" "publication_audience_dimension" NOT NULL,
	"provenance_policy" "publication_audience_provenance_policy" NOT NULL,
	"campus_id" uuid,
	"academic_division_id" uuid,
	"programme_id" uuid,
	"academic_year" integer,
	"residence_target" "publication_audience_residence_target",
	"residence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_audience_criteria_payload_shape" CHECK ((
        ("publication_audience_criteria"."dimension" = 'campus' AND "publication_audience_criteria"."campus_id" IS NOT NULL AND "publication_audience_criteria"."academic_division_id" IS NULL AND "publication_audience_criteria"."programme_id" IS NULL AND "publication_audience_criteria"."academic_year" IS NULL AND "publication_audience_criteria"."residence_target" IS NULL AND "publication_audience_criteria"."residence_id" IS NULL)
        OR ("publication_audience_criteria"."dimension" = 'academic_division' AND "publication_audience_criteria"."campus_id" IS NULL AND "publication_audience_criteria"."academic_division_id" IS NOT NULL AND "publication_audience_criteria"."programme_id" IS NULL AND "publication_audience_criteria"."academic_year" IS NULL AND "publication_audience_criteria"."residence_target" IS NULL AND "publication_audience_criteria"."residence_id" IS NULL)
        OR ("publication_audience_criteria"."dimension" = 'programme' AND "publication_audience_criteria"."campus_id" IS NULL AND "publication_audience_criteria"."academic_division_id" IS NULL AND "publication_audience_criteria"."programme_id" IS NOT NULL AND "publication_audience_criteria"."academic_year" IS NULL AND "publication_audience_criteria"."residence_target" IS NULL AND "publication_audience_criteria"."residence_id" IS NULL)
        OR ("publication_audience_criteria"."dimension" = 'academic_year' AND "publication_audience_criteria"."campus_id" IS NULL AND "publication_audience_criteria"."academic_division_id" IS NULL AND "publication_audience_criteria"."programme_id" IS NULL AND "publication_audience_criteria"."academic_year" IS NOT NULL AND "publication_audience_criteria"."academic_year" >= 1 AND "publication_audience_criteria"."residence_target" IS NULL AND "publication_audience_criteria"."residence_id" IS NULL)
        OR ("publication_audience_criteria"."dimension" = 'residence' AND "publication_audience_criteria"."campus_id" IS NULL AND "publication_audience_criteria"."academic_division_id" IS NULL AND "publication_audience_criteria"."programme_id" IS NULL AND "publication_audience_criteria"."academic_year" IS NULL AND "publication_audience_criteria"."residence_target" IS NOT NULL AND (("publication_audience_criteria"."residence_target" = 'specific_residence' AND "publication_audience_criteria"."residence_id" IS NOT NULL) OR ("publication_audience_criteria"."residence_target" IN ('any_resident', 'non_resident') AND "publication_audience_criteria"."residence_id" IS NULL)))
      ))
);
--> statement-breakpoint
ALTER TABLE "publication_audience_criteria" ADD CONSTRAINT "publication_audience_criteria_publication_same_tenant_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "publication_audience_criteria" ADD CONSTRAINT "publication_audience_criteria_campus_same_tenant_fk" FOREIGN KEY ("tenant_id","campus_id") REFERENCES "public"."campuses"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "publication_audience_criteria" ADD CONSTRAINT "publication_audience_criteria_division_same_tenant_fk" FOREIGN KEY ("tenant_id","academic_division_id") REFERENCES "public"."academic_divisions"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "publication_audience_criteria" ADD CONSTRAINT "publication_audience_criteria_programme_same_tenant_fk" FOREIGN KEY ("tenant_id","programme_id") REFERENCES "public"."programmes"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "publication_audience_criteria" ADD CONSTRAINT "publication_audience_criteria_residence_same_tenant_fk" FOREIGN KEY ("tenant_id","residence_id") REFERENCES "public"."residences"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_campus_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","campus_id") WHERE "publication_audience_criteria"."dimension" = 'campus';--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_division_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","academic_division_id") WHERE "publication_audience_criteria"."dimension" = 'academic_division';--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_programme_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","programme_id") WHERE "publication_audience_criteria"."dimension" = 'programme';--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_academic_year_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","academic_year") WHERE "publication_audience_criteria"."dimension" = 'academic_year';--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_specific_residence_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","residence_id") WHERE "publication_audience_criteria"."dimension" = 'residence' AND "publication_audience_criteria"."residence_target" = 'specific_residence';--> statement-breakpoint
CREATE UNIQUE INDEX "publication_audience_criteria_residence_target_unique" ON "publication_audience_criteria" USING btree ("tenant_id","publication_id","residence_target") WHERE "publication_audience_criteria"."dimension" = 'residence' AND "publication_audience_criteria"."residence_target" IN ('any_resident', 'non_resident');
