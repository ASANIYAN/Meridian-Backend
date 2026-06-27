ALTER TABLE "operations" ALTER COLUMN "payload" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "operations" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "yjs_update" "bytea" DEFAULT null;