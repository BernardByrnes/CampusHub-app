CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_facts" jsonb NOT NULL,
	"previous_hash" text NOT NULL,
	"current_hash" text NOT NULL,
	"key_version" integer NOT NULL,
	"integrity_format_version" integer NOT NULL,
	"event_contract_version" integer NOT NULL,
	CONSTRAINT "audit_events_tenant_sequence_unique" UNIQUE("tenant_id","sequence"),
	CONSTRAINT "audit_events_sequence_positive" CHECK ("audit_events"."sequence" >= 1),
	CONSTRAINT "audit_events_event_type_closed" CHECK ("audit_events"."event_type" IN ('publication.published')),
	CONSTRAINT "audit_events_resource_type_closed" CHECK ("audit_events"."resource_type" = 'publication'),
	CONSTRAINT "audit_events_resource_version_positive" CHECK ("audit_events"."resource_version" IS NULL OR "audit_events"."resource_version" >= 1),
	CONSTRAINT "audit_events_event_facts_object" CHECK (jsonb_typeof("audit_events"."event_facts") = 'object'),
	CONSTRAINT "audit_events_hash_shape" CHECK ("audit_events"."previous_hash" ~ '^[0-9a-f]{64}$' AND "audit_events"."current_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_events_key_version_positive" CHECK ("audit_events"."key_version" >= 1),
	CONSTRAINT "audit_events_integrity_format_supported" CHECK ("audit_events"."integrity_format_version" = 1),
	CONSTRAINT "audit_events_event_contract_supported" CHECK ("audit_events"."event_contract_version" = 1)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_same_tenant_fk" FOREIGN KEY ("tenant_id","actor_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_resource" ON "audit_events" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_tenant_event_type" ON "audit_events" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "audit_events_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_reject_row_mutation"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "audit_events_reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "audit_events_reject_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "audit_events_reject_mutation"();--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_audit_owner') THEN
    CREATE ROLE campushub_audit_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campushub_runtime') THEN
    CREATE ROLE campushub_runtime NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "audit_events" OWNER TO "campushub_audit_owner";--> statement-breakpoint
REVOKE ALL ON TABLE "audit_events" FROM PUBLIC;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "audit_events" TO "campushub_runtime";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "audit_events" FROM "campushub_runtime";
