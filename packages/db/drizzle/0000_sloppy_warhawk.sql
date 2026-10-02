CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"mechanism" text,
	"kpi_targets" jsonb,
	"milestones" jsonb,
	"partners" text[] DEFAULT '{}' NOT NULL,
	"verification_level" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"smart" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"problem_statement" text NOT NULL,
	"scope" text NOT NULL,
	"baseline_metric" text NOT NULL,
	"baseline_source_url" text NOT NULL,
	"baseline_retrieved_at" timestamp with time zone NOT NULL,
	"target_metric" text NOT NULL,
	"deadline" date NOT NULL,
	"interventions" text[] DEFAULT '{}' NOT NULL,
	"risks_and_externalities" text,
	"smart_ratings" jsonb,
	"priority_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"smartness_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"proposed_by" uuid,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"fact_type" text NOT NULL,
	"fact_key" text NOT NULL,
	"fact_value" jsonb NOT NULL,
	"source_url" text NOT NULL,
	"source_type" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"estimation_method" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wikidata_id" text,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"birth_year" integer,
	"country" text,
	"state" text,
	"industry" text[] DEFAULT '{}' NOT NULL,
	"gender" text,
	"images" text[] DEFAULT '{}' NOT NULL,
	"public_figure" boolean DEFAULT true NOT NULL,
	"us_presence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_by" uuid,
	"badges" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_scored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_wikidata_id_unique" UNIQUE("wikidata_id")
);
--> statement-breakpoint
CREATE TABLE "progress_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commitment_id" uuid NOT NULL,
	"kpi_values" jsonb,
	"evidence_links" jsonb,
	"narrative" text,
	"verification_level" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"pbs" numeric(5, 2) NOT NULL,
	"features" jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"verified" boolean DEFAULT false NOT NULL,
	"trust_score" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"newsletter_frequency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"direction" smallint NOT NULL,
	"weight" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_ratings" ADD CONSTRAINT "goal_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_ratings" ADD CONSTRAINT "goal_ratings_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_facts" ADD CONSTRAINT "person_facts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_updates" ADD CONSTRAINT "progress_updates_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_snapshots" ADD CONSTRAINT "score_snapshots_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commitments_person_idx" ON "commitments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "commitments_goal_idx" ON "commitments" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_ratings_user_goal_uniq" ON "goal_ratings" USING btree ("user_id","goal_id");--> statement-breakpoint
CREATE INDEX "goal_ratings_goal_idx" ON "goal_ratings" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_status_idx" ON "goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "goals_priority_idx" ON "goals" USING btree ("priority_score");--> statement-breakpoint
CREATE INDEX "person_facts_person_idx" ON "person_facts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_facts_type_idx" ON "person_facts" USING btree ("person_id","fact_type");--> statement-breakpoint
CREATE INDEX "persons_name_idx" ON "persons" USING btree ("name");--> statement-breakpoint
CREATE INDEX "persons_state_idx" ON "persons" USING btree ("state");--> statement-breakpoint
CREATE INDEX "progress_commitment_idx" ON "progress_updates" USING btree ("commitment_id");--> statement-breakpoint
CREATE INDEX "scores_person_date_idx" ON "score_snapshots" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_person_date_uniq" ON "score_snapshots" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "votes_user_person_uniq" ON "votes" USING btree ("user_id","person_id");--> statement-breakpoint
CREATE INDEX "votes_person_idx" ON "votes" USING btree ("person_id");