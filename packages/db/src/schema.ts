import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  smallint,
  date,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Users ---
// Auth is handled by Supabase Auth. This table extends auth.users
// with app-specific fields. The id matches the Supabase auth user id.

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  verified: boolean("verified").default(false).notNull(),
  trustScore: numeric("trust_score", { precision: 5, scale: 2 }).default("1.00").notNull(),
  newsletterFrequency: text("newsletter_frequency"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- Persons (Billionaires) ---

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    wikidataId: text("wikidata_id").unique(),
    name: text("name").notNull(),
    aliases: text("aliases").array().default([]).notNull(),
    birthYear: integer("birth_year"),
    deathYear: integer("death_year"),
    country: text("country"),
    state: text("state"),
    industry: text("industry").array().default([]).notNull(),
    gender: text("gender"),
    images: text("images").array().default([]).notNull(),
    publicFigure: boolean("public_figure").default(true).notNull(),
    usPresence: jsonb("us_presence").default([]).notNull(),
    proposedBy: uuid("proposed_by").references(() => users.id),
    // Moderation gate for user-proposed persons (R-025). Seeded rows default to
    // "approved" (grandfathered live); /billionaires/propose writes "pending",
    // which every public read path filters out until an admin approves. Values:
    // "pending" | "approved" | "rejected". Reversible: drop column + filters.
    reviewStatus: text("review_status").default("approved").notNull(),
    // The proposer's free-text justification ("why should they be included?").
    // Captured for the admin review view; the propose endpoint previously
    // discarded it. Null for seeded rows.
    proposalReason: text("proposal_reason"),
    badges: jsonb("badges").default({}).notNull(),
    lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("persons_name_idx").on(table.name),
    index("persons_state_idx").on(table.state),
  ]
);

// --- Person Facts ---

export const personFacts = pgTable(
  "person_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    factType: text("fact_type").notNull(),
    factKey: text("fact_key").notNull(),
    factValue: jsonb("fact_value").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceType: text("source_type"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    estimationMethod: text("estimation_method"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("person_facts_person_idx").on(table.personId),
    index("person_facts_type_idx").on(table.personId, table.factType),
  ]
);

// --- Goals ---

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    problemStatement: text("problem_statement").notNull(),
    scope: text("scope").notNull(),
    baselineMetric: text("baseline_metric").notNull(),
    baselineSourceUrl: text("baseline_source_url").notNull(),
    baselineRetrievedAt: timestamp("baseline_retrieved_at", { withTimezone: true }).notNull(),
    targetMetric: text("target_metric").notNull(),
    deadline: date("deadline").notNull(),
    interventions: text("interventions").array().default([]).notNull(),
    kpis: jsonb("kpis").default([]).notNull(),
    milestones: jsonb("milestones").default([]).notNull(),
    risksAndExternalities: text("risks_and_externalities"),
    smartRatings: jsonb("smart_ratings"),
    priorityScore: numeric("priority_score", { precision: 5, scale: 2 }).default("0").notNull(),
    smartnessScore: numeric("smartness_score", { precision: 5, scale: 2 }).default("0").notNull(),
    proposedBy: uuid("proposed_by").references(() => users.id),
    status: text("status").default("proposed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("goals_status_idx").on(table.status),
    index("goals_priority_idx").on(table.priorityScore),
  ]
);

// --- Commitments ---

export const commitments = pgTable(
  "commitments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    goalId: uuid("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    mechanism: text("mechanism"),
    kpiTargets: jsonb("kpi_targets"),
    milestones: jsonb("milestones"),
    partners: text("partners").array().default([]).notNull(),
    verificationLevel: smallint("verification_level").default(0).notNull(),
    status: text("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("commitments_person_idx").on(table.personId),
    index("commitments_goal_idx").on(table.goalId),
  ]
);

// --- Progress Updates ---

export const progressUpdates = pgTable(
  "progress_updates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commitmentId: uuid("commitment_id")
      .references(() => commitments.id, { onDelete: "cascade" })
      .notNull(),
    kpiValues: jsonb("kpi_values"),
    evidenceLinks: jsonb("evidence_links"),
    narrative: text("narrative"),
    verificationLevel: smallint("verification_level").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("progress_commitment_idx").on(table.commitmentId)]
);

// --- Score Snapshots ---

export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    date: date("date").notNull(),
    pbs: numeric("pbs", { precision: 5, scale: 2 }).notNull(),
    features: jsonb("features").notNull(),
    sources: jsonb("sources").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scores_person_date_idx").on(table.personId, table.date),
    uniqueIndex("scores_person_date_uniq").on(table.personId, table.date),
  ]
);

// --- Votes ---

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
    direction: smallint("direction").notNull(),
    weight: numeric("weight", { precision: 5, scale: 2 }).default("1.00").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("votes_user_person_uniq").on(table.userId, table.personId),
    index("votes_person_idx").on(table.personId),
  ]
);

// --- Goal Rewrites ---

export const goalRewrites = pgTable(
  "goal_rewrites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    proposedBy: uuid("proposed_by")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    changes: jsonb("changes").notNull(),
    comment: text("comment").notNull(),
    upvotes: integer("upvotes").default(0).notNull(),
    downvotes: integer("downvotes").default(0).notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("goal_rewrites_goal_idx").on(table.goalId),
    index("goal_rewrites_status_idx").on(table.goalId, table.status),
  ]
);

export const goalRewriteVotes = pgTable(
  "goal_rewrite_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rewriteId: uuid("rewrite_id")
      .references(() => goalRewrites.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    direction: smallint("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("rewrite_votes_user_rewrite_uniq").on(table.userId, table.rewriteId),
    index("rewrite_votes_rewrite_idx").on(table.rewriteId),
  ]
);

// --- Goal Ratings ---

export const goalRatings = pgTable(
  "goal_ratings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    goalId: uuid("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    priority: integer("priority").notNull(),
    smart: jsonb("smart").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("goal_ratings_user_goal_uniq").on(table.userId, table.goalId),
    index("goal_ratings_goal_idx").on(table.goalId),
  ]
);

// --- Feed Items ---

export const feedItems = pgTable(
  "feed_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceName: text("source_name").notNull(),
    category: text("category").notNull(),
    contextData: jsonb("context_data").default({}).notNull(),
    curationScore: numeric("curation_score", { precision: 5, scale: 2 }).default("0").notNull(),
    upvotes: integer("upvotes").default(0).notNull(),
    downvotes: integer("downvotes").default(0).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feed_items_published_idx").on(table.publishedAt),
    index("feed_items_category_idx").on(table.category),
  ]
);

// --- Feed Item Persons (junction) ---

export const feedItemPersons = pgTable(
  "feed_item_persons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedItemId: uuid("feed_item_id")
      .references(() => feedItems.id, { onDelete: "cascade" })
      .notNull(),
    personId: uuid("person_id")
      .references(() => persons.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    uniqueIndex("feed_item_persons_uniq").on(table.feedItemId, table.personId),
    index("feed_item_persons_feed_idx").on(table.feedItemId),
    index("feed_item_persons_person_idx").on(table.personId),
  ]
);

// --- Feed Comments ---

export const feedComments = pgTable(
  "feed_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedItemId: uuid("feed_item_id")
      .references(() => feedItems.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    upvotes: integer("upvotes").default(0).notNull(),
    downvotes: integer("downvotes").default(0).notNull(),
    // Moderation hide flag: true = excluded from every public read (comment
    // lists + counts); set via POST /api/feed/comments/:commentId/moderate
    // (admin). Soft-hide rather than delete so moderated content stays
    // auditable — relevant for takedown disputes.
    flagged: boolean("flagged").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feed_comments_item_idx").on(table.feedItemId),
    index("feed_comments_user_idx").on(table.userId),
  ]
);

// --- Curator passed-over cooldown (R-048) ---
//
// What Pass A REFUSED, so it stops re-occupying a top-20 slot forever. Measured
// 2026-08-07 against live candidates: 13 of 20 slots were held by stories the
// selector had already declined on a prior run, six of them byte-identical.
// Refused candidates are never published, so nothing consumed them and GDELT
// re-served them into the same slots the next day — a starvation loop.
//
// Keyed on EVENT SIGNATURE, not url or person. The same article arrives under a
// different person row across runs ("Bezos Is Third-Richest Again" sat on Jeff
// Bezos on 8/05 and on Sergey Brin on 8/07), so a person- or url-keyed cooldown
// misses exactly the re-serves it exists to catch.
// Stores the TITLE, not a serialized signature: eventSignature() returns a Set,
// so persisting it would mean inventing a serialization format, and any future
// retune of that function would silently mismatch every stored row. Recomputing
// on read costs nothing at this volume (tens of rows a day) and self-heals.
// B-052: the table used to hold ONE kind of row — a candidate Pass A declined — and a
// candidate a VERIFIER refused was recorded nowhere, so it returned at full rank the next
// time GDELT re-served it (the Earl Woods story was refused on 09-14 and again on 09-19,
// five days inside the 14-day window). Two columns make the second kind storable:
//
//   source    which stage refused it. DEFAULTS to the Pass A value because
//             scripts/read-passed-over-composition.mjs decides R-048 branch (a) from the
//             noise fraction of THIS table, and Pass A rows are its population — a new
//             KIND of row silently moves a denominator another decision already rests on
//             (6 noisy of 10 becomes 6 of 13 and a DOMINATED verdict flips with Pass A's
//             behaviour unchanged). That reader filters on 'pass-a'; the cooldown lookup
//             deliberately does not, so it stays inclusive.
//   personId  NULL for a Pass A refusal, which is person-blind BY DESIGN (the same article
//             arrives under a different person across runs). Set for a Pass B refusal,
//             which is person-SCOPED: Pass B asks "is THIS billionaire the subject?" and
//             "is this about THIS billionaire's money?", so the same article legitimately
//             returns under a different person. Without this column a Pass B row would
//             cool the event for EVERYONE and sink the correctly-attributed version —
//             which is why the three title-only scopes on B-052 were each rejected.
export const curatorPassedOver = pgTable(
  "curator_passed_over",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    source: text("source").default("pass-a").notNull(),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "cascade" }),
    passedOverAt: timestamp("passed_over_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("curator_passed_over_at_idx").on(table.passedOverAt)]
);

// --- Feed Votes ---

export const feedVotes = pgTable(
  "feed_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedItemId: uuid("feed_item_id")
      .references(() => feedItems.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    direction: smallint("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("feed_votes_user_item_uniq").on(table.userId, table.feedItemId),
    index("feed_votes_item_idx").on(table.feedItemId),
  ]
);
