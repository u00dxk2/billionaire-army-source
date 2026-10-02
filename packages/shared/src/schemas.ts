import { z } from "zod";

// --- Persons ---

export const usPresenceSchema = z.object({
  type: z.enum([
    "holdings",
    "investments",
    "property",
    "residence",
    "business",
    "other",
  ]),
  details: z.string(),
});

export const badgesSchema = z.object({
  givingPledge: z.boolean().default(false),
  claimedPage: z.boolean().default(false),
  goalAdopted: z.boolean().default(false),
});

export const personSchema = z.object({
  id: z.string().uuid(),
  wikidataId: z.string().nullable(),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  birthYear: z.number().int().nullable(),
  country: z.string().nullable(),
  state: z.string().nullable(),
  industry: z.array(z.string()).default([]),
  gender: z.string().nullable(),
  images: z.array(z.string()).default([]),
  publicFigure: z.boolean().default(true),
  reviewStatus: z.enum(["pending", "approved", "rejected"]).default("approved"),
  usPresence: z.array(usPresenceSchema).default([]),
  badges: badgesSchema.default({}),
});

// --- Person Facts ---

export const estimationMethodSchema = z.enum([
  "wikidata",
  "sec_derived",
  "web_search",
  "manual",
  "proPublica_990",
  "fec",
  "newsapi",
  "littlesis",
  "rtb",
  "llm_summary",
]);

export const personFactSchema = z.object({
  id: z.string().uuid(),
  personId: z.string().uuid(),
  factType: z.string(),
  factKey: z.string(),
  factValue: z.unknown(),
  sourceUrl: z.string().url(),
  sourceType: z.string().nullable(),
  retrievedAt: z.string().datetime(),
  estimationMethod: estimationMethodSchema.nullable(),
});

// --- Goals ---

export const goalStatusSchema = z.enum([
  "draft",
  "proposed",
  "active",
  "archived",
]);

export const smartRatingsSchema = z.object({
  S: z.number().min(1).max(5),
  M: z.number().min(1).max(5),
  A: z.number().min(1).max(5),
  R: z.number().min(1).max(5),
  T: z.number().min(1).max(5),
});

export const kpiSchema = z.object({
  name: z.string().min(1).max(200),
  unit: z.string().max(50),
  baselineValue: z.number(),
  targetValue: z.number(),
});

export const milestoneSchema = z.object({
  title: z.string().min(1).max(300),
  targetDate: z.string(),
  targetValue: z.string().max(200).optional(),
  status: z.enum(["pending", "reached", "missed"]).default("pending"),
});

export const createGoalSchema = z.object({
  title: z.string().min(5).max(200),
  problemStatement: z.string().min(10).max(2000),
  scope: z.string().min(5).max(500),
  baselineMetric: z.string().min(5).max(500),
  baselineSourceUrl: z.string().url(),
  targetMetric: z.string().min(5).max(500),
  deadline: z.string(),
  interventions: z.array(z.string()).min(1),
  kpis: z.array(kpiSchema).default([]),
  milestones: z.array(milestoneSchema).default([]),
  risksAndExternalities: z.string().max(2000).optional(),
});

export const goalSchema = createGoalSchema.extend({
  id: z.string().uuid(),
  baselineRetrievedAt: z.string().datetime(),
  smartRatings: smartRatingsSchema.nullable(),
  priorityScore: z.number().default(0),
  smartnessScore: z.number().default(0),
  proposedBy: z.string().uuid().nullable(),
  status: goalStatusSchema.default("proposed"),
});

// --- Goal Rewrites ---

export const goalRewriteChangesSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  problemStatement: z.string().min(10).max(2000).optional(),
  scope: z.string().min(5).max(500).optional(),
  targetMetric: z.string().min(5).max(500).optional(),
  deadline: z.string().optional(),
  interventions: z.array(z.string()).min(1).optional(),
}).refine((data) => Object.values(data).some((v) => v !== undefined), {
  message: "At least one field must be changed",
});

export const createGoalRewriteSchema = z.object({
  changes: goalRewriteChangesSchema,
  comment: z.string().min(5).max(500),
});

export const rewriteVoteSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export type GoalRewriteChanges = z.infer<typeof goalRewriteChangesSchema>;
export type CreateGoalRewrite = z.infer<typeof createGoalRewriteSchema>;

// --- Person Proposals ---

export const proposePersonSchema = z.object({
  name: z.string().min(2).max(200),
  reason: z.string().min(10).max(1000),
  industry: z.array(z.string()).default([]),
  state: z.string().max(100).optional(),
  wikidataId: z.string().max(50).optional(),
});

export type ProposePerson = z.infer<typeof proposePersonSchema>;

// Admin moderation action on a proposed person (R-025).
export const reviewActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export type ReviewAction = z.infer<typeof reviewActionSchema>;

// --- Votes ---

export const voteDirectionSchema = z.enum(["approve", "disapprove"]);

export const createVoteSchema = z.object({
  personId: z.string().uuid(),
  direction: voteDirectionSchema,
  // B-051: when the voter chose, so two overlapping votes on one person resolve to their LAST
  // verdict whatever order the requests commit in. Optional — an older client is never refused.
  castAt: z.number().int().positive().optional(),
});

// --- Goal Ratings ---

export const createGoalRatingSchema = z.object({
  goalId: z.string().uuid(),
  priority: z.number().int().min(1).max(5),
  smart: smartRatingsSchema,
});

// --- Feed ---

export const feedCategorySchema = z.enum([
  "politics",
  "philanthropy",
  "business",
  "sec_filing",
  "controversy",
]);

export const feedVoteSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export const feedCommentSchema = z.object({
  body: z.string().min(5).max(1000),
});

// Admin comment moderation (hide/restore) — see feed_comments.flagged.
export const feedCommentModerateSchema = z.object({
  hidden: z.boolean(),
});

export type FeedCategory = z.infer<typeof feedCategorySchema>;
export type FeedVote = z.infer<typeof feedVoteSchema>;
export type FeedComment = z.infer<typeof feedCommentSchema>;
export type FeedCommentModerate = z.infer<typeof feedCommentModerateSchema>;

// --- PBS Score ---

// PBS v2 features (see ./pbs.ts). philanthropy + transparency are the weighted
// components; pledge/generosity/scale/sourceCount are sub-signals shown in the
// transparent score breakdown.
export const pbsFeaturesSchema = z.object({
  philanthropy: z.number().default(0),
  transparency: z.number().default(0),
  pledge: z.number().default(0),
  generosity: z.number().default(0),
  scale: z.number().default(0),
  sourceCount: z.number().default(0),
  // Annualized documented direct giving (USD) used in the generosity numerator,
  // 0 if none (R-007). Surfaced so the score breakdown can show when a grade is
  // driven by direct giving rather than 990 foundation data.
  directGiving: z.number().default(0),
});

// --- API response wrappers ---

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(2000).default(20),
});

export type Person = z.infer<typeof personSchema>;
export type PersonFact = z.infer<typeof personFactSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type CreateGoal = z.infer<typeof createGoalSchema>;
export type Vote = z.infer<typeof createVoteSchema>;
export type GoalRating = z.infer<typeof createGoalRatingSchema>;
export type SmartRatings = z.infer<typeof smartRatingsSchema>;
export type PbsFeatures = z.infer<typeof pbsFeaturesSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type UsPresence = z.infer<typeof usPresenceSchema>;
export type Badges = z.infer<typeof badgesSchema>;
export type EstimationMethod = z.infer<typeof estimationMethodSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type VoteDirection = z.infer<typeof voteDirectionSchema>;
export type Kpi = z.infer<typeof kpiSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
