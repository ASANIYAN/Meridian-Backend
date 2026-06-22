CREATE TYPE "public"."operation_source" AS ENUM('human', 'ai');--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "source" "operation_source" NOT NULL DEFAULT 'human';
