CREATE TYPE "public"."oauth_client_kind" AS ENUM('cimd', 'registered');--> statement-breakpoint
CREATE TABLE "oauth_login_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request" jsonb NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forget_requests" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "forget_requests" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "forget_requests" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD COLUMN "resource" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "kind" "oauth_client_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "metadata_url" text;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "resource" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "family_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_login_sessions" ADD CONSTRAINT "oauth_login_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forget_requests" ADD CONSTRAINT "forget_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");