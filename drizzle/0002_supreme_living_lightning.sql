ALTER TYPE "public"."operation_type" ADD VALUE 'yjs_update';--> statement-breakpoint
ALTER TABLE "operations" ALTER COLUMN "clock_value" DROP NOT NULL;