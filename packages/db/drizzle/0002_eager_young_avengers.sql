CREATE TABLE "goal_rewrite_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rewrite_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_rewrites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"comment" text NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_rewrite_votes" ADD CONSTRAINT "goal_rewrite_votes_rewrite_id_goal_rewrites_id_fk" FOREIGN KEY ("rewrite_id") REFERENCES "public"."goal_rewrites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_rewrite_votes" ADD CONSTRAINT "goal_rewrite_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_rewrites" ADD CONSTRAINT "goal_rewrites_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_rewrites" ADD CONSTRAINT "goal_rewrites_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rewrite_votes_user_rewrite_uniq" ON "goal_rewrite_votes" USING btree ("user_id","rewrite_id");--> statement-breakpoint
CREATE INDEX "rewrite_votes_rewrite_idx" ON "goal_rewrite_votes" USING btree ("rewrite_id");--> statement-breakpoint
CREATE INDEX "goal_rewrites_goal_idx" ON "goal_rewrites" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_rewrites_status_idx" ON "goal_rewrites" USING btree ("goal_id","status");