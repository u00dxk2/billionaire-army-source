ALTER TABLE "goals" ADD COLUMN "kpis" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "milestones" jsonb DEFAULT '[]'::jsonb NOT NULL;