CREATE TABLE "feed_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_item_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"source_url" text NOT NULL,
	"source_name" text NOT NULL,
	"category" text NOT NULL,
	"context_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"curation_score" numeric(5, 2) DEFAULT '0' NOT NULL,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item_persons" ADD CONSTRAINT "feed_item_persons_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_item_persons" ADD CONSTRAINT "feed_item_persons_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_votes" ADD CONSTRAINT "feed_votes_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_votes" ADD CONSTRAINT "feed_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_comments_item_idx" ON "feed_comments" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "feed_comments_user_idx" ON "feed_comments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_item_persons_uniq" ON "feed_item_persons" USING btree ("feed_item_id","person_id");--> statement-breakpoint
CREATE INDEX "feed_item_persons_feed_idx" ON "feed_item_persons" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "feed_item_persons_person_idx" ON "feed_item_persons" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "feed_items_published_idx" ON "feed_items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "feed_items_category_idx" ON "feed_items" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_votes_user_item_uniq" ON "feed_votes" USING btree ("user_id","feed_item_id");--> statement-breakpoint
CREATE INDEX "feed_votes_item_idx" ON "feed_votes" USING btree ("feed_item_id");