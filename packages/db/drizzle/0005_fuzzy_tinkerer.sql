ALTER TABLE "persons" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "proposal_reason" text;