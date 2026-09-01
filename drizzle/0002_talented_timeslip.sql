CREATE TYPE "public"."publication_priority" AS ENUM('standard', 'priority');--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "priority" "publication_priority" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "author_office_label" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_author_office_label_nonempty" CHECK (char_length(btrim("publications"."author_office_label")) > 0);