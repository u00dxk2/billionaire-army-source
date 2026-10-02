CREATE TABLE "curator_passed_over" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"passed_over_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "curator_passed_over_at_idx" ON "curator_passed_over" USING btree ("passed_over_at");