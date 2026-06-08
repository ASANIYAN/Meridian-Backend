ALTER TABLE "users" ADD COLUMN "verification_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_token_expires_at" timestamp with time zone;