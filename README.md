# Billionaire Army

This is the source code for [billionaire.army](https://billionaire.army).

Billionaire Army keeps a public record on U.S. billionaires: net worth, federal
political donations, foundation giving and news. Once the scoring job has run,
each indexed person gets a **Public Benefit Score** worked out by an open
formula. Separately, the public proposes and rates goals for the country, and a
goal page can show heuristic matches: billionaires whose profile fits the goal.

Goals do not feed the score. The score combines giving relative to wealth,
absolute giving, Giving Pledge status, and how much public information is held
about the person. When a goal page
suggests a billionaire, that is a suggestion about fit. It never claims that
person could have solved the problem.

A [Skylark Creations](https://skylarkcreations.com) project.

## The Public Benefit Score

The score runs from 0 to 100:

```
PBS = 100 × (0.65 × Philanthropy + 0.35 × Transparency)
```

Philanthropy combines an annual giving figure (a foundation-expense-derived
amount from 990 filings, or annualized curated direct giving, whichever is
larger) compared with net worth, the absolute amount, and Giving Pledge status.
Transparency counts the distinct fact types held on the person, plus one for a
profile image. Letter grades run A (60 and up) through F (under 15).

[METHODOLOGY.md](METHODOLOGY.md) describes the v2 method, its known
limitations, and what the score leaves out. The code is in
`packages/shared/src/pbs.ts`.

## Where the data comes from

| Source | What we take | Code |
| --- | --- | --- |
| Wikidata | the starting list of billionaires, birth years | `packages/jobs/src/fetchers/wikidata*.ts` |
| realtimebillionaires.de | billionaires missing from Wikidata; state, industry, net worth | `packages/jobs/src/fetchers/rtb-seed.ts` |
| FEC (Federal Election Commission) | federal political contributions | `packages/jobs/src/fetchers/fec.ts` |
| SEC EDGAR | company filings | `packages/jobs/src/fetchers/sec-edgar.ts` |
| ProPublica Nonprofit Explorer | foundation 990 filings: assets and annual giving | `packages/jobs/src/fetchers/propublica-990.ts` |
| The Giving Pledge | signatory list | `packages/jobs/src/fetchers/giving-pledge.ts` |
| GDELT and NewsAPI.ai | news articles that name each person | `packages/jobs/src/fetchers/gdelt.ts`, `newsapi.ts` |
| Hand-curated, sourced lists | direct giving that leaves no 990; plain-language company profiles | `packages/jobs/src/fetchers/direct-giving-data.ts`, `business-data.ts` |

Each stored fact keeps its source URL and the time it was retrieved. Language
models (configured in `model-seats.json`) write the profile summaries and the
news feed cards. The feed curator runs separate model passes that judge each
draft card for relevance and for faithfulness to its source article. Two limits
apply: the faithfulness check only logs by default and drops nothing unless
`CURATOR_FAITHFULNESS_ENFORCE=1` is set, and both verifiers fail open (if a
verifier returns nothing, no card is dropped). So these passes do not guarantee
that every published card was verified. See
`packages/jobs/src/fetchers/feed-curator.ts` and `profile-summary.ts`.

The jobs can call an optional LLM-call log (`packages/jobs/src/fetchers/llm-call-log.ts`).
It is off unless you set `LLM_CALL_LOG_URL` to a sink you run, and it has no
built-in destination.

Job schedules for the hosted site are not part of this repository. The examples
below run selected jobs by hand; the full list of job commands is in
`package.json` and `packages/jobs/package.json`.

Some curated corrections are tied to the hosted site's own data. In particular,
`packages/jobs/src/fetchers/foundation-trustee-review.ts` (which limits the
foundations a reviewed person can be attached to) is keyed by the production
database's person ids. A fresh install generates new ids, so those reviews match
no one there and do not apply.

## Stack

A TypeScript monorepo using npm workspaces.

```
packages/
  shared/   scoring formula, Zod schemas and shared logic
  db/       Drizzle ORM schema and SQL migrations (Postgres)
  api/      Fastify REST API
  web/      Next.js 15 web app (React 19)
  jobs/     data fetchers, feed curator, scoring
```

The database is Postgres, and sign-in uses Supabase Auth. The jobs talk to the
database directly, and the per-person rescoring worker uses pg-boss.

## Running it locally

You need Node 22 or later, and a Postgres database. A Supabase project can
supply both the database and auth.

```bash
npm ci
cp .env.example .env          # fill in at least the database and Supabase values
set -a; . ./.env; set +a      # load them into your shell (the scripts do not read .env themselves)

npm run db:migrate            # create the tables

# Database security: required on Supabase, run after every fresh migrate.
for f in packages/db/sql/*.sql; do psql "$DATABASE_URL" -f "$f"; done
npm run check:rls             # verify it (see below)

npm run db:seed               # a handful of sample billionaires and goals (sample data, not verified facts)

npm run dev:api               # API on http://localhost:3001
npm run dev:web               # web app on http://localhost:3000
```

### Database security

The app uses Supabase for sign-in only; all data goes through the API, which
connects to Postgres directly. Supabase's default setup grants its public
`anon` and `authenticated` roles full access to new tables in the `public`
schema, and the Drizzle migrations do not remove that. Without the step above,
anyone holding the public anon key (which ships in the web bundle) could read
and write the tables through Supabase's REST API.

The SQL in `packages/db/sql/` is applied by hand, outside the Drizzle
migrations. It revokes those grants, changes the default privileges so new
tables are not granted again, and turns on row-level security. Each file is
idempotent, so re-running it is safe.

`npm run check:rls` verifies the result. It needs `NEXT_PUBLIC_SUPABASE_URL`
and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and tries to read sample tables with the
anon key over the REST API. With `DATABASE_URL` set it also lists any table
without row-level security, any grant still held by `anon`, `authenticated` or
`PUBLIC`, and any default privilege that would re-grant a new table. It exits 0
when access is denied and 1 when anything is exposed. Run it after every
migration: a new table added by a migration does not get row-level security
until you enable it.

Checks that need no database or keys:

```bash
npm run typecheck
npm test
```

Data jobs (each needs `DATABASE_URL`, and some need an API key from `.env.example`):

```bash
npm run seed:wikidata         # build the person list
npm run fetch:fec             # political contributions (FEC_API_KEY)
npm run fetch:990             # foundation filings
npm run fetch:gdelt           # news (no key)
npm run score:all             # compute every Public Benefit Score
npm run curate:feed           # write the news feed (OPENAI_API_KEY)
```

`packages/db/sql/` holds row-level-security statements that are applied by
hand, outside the Drizzle migrations.

## Found a wrong number?

Accuracy is the whole point of this project. If a figure on the site is wrong,
please tell us. Email **hello@skylarkcreations.com** or open an issue here. A
link to the page and to the source showing the right figure helps most.

## Security

See [SECURITY.md](SECURITY.md).

## License

Not chosen yet. See [LICENSE-PENDING.md](LICENSE-PENDING.md).
