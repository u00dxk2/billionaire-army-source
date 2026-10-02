ALTER TABLE "curator_passed_over" ADD COLUMN "source" text DEFAULT 'pass-a' NOT NULL;--> statement-breakpoint
ALTER TABLE "curator_passed_over" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "curator_passed_over" ADD CONSTRAINT "curator_passed_over_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;