# Spike

Mobile-first meal education: identify foods from photos, speech or text, explore illustrative glucose curves, and log meals locally.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Meal logs stay only in localStorage. Do not introduce a server database for meal history.
- Photo/text meal data is sent transiently to managed AI; analytics send only anonymous allowlisted event properties, never food descriptions or media.
- All curves and reductions are illustrative, not measurements or personalized medical predictions. Never use these for insulin or medication decisions.
- Selecting a walk fix is a plan, not evidence of walking; only explicitly completed walks count in the weekly view.
- Demo mode must preserve real logs and suppress analytics for demo records. Its requested 5-day streak is explicitly simulated: two meals on each of seven days would otherwise imply seven.
- Voice summaries are educational illustrations, not medical advice. Keep the ElevenLabs key and requests on the server; browser speech is only the explicitly requested failure/timeout fallback.
- Calories are secondary to glucose: label them "Estimate" and derive them in the same meal-analysis call, including recalculation after food edits.
- Walking locations stay transient and never enter logs or analytics. A park beyond ~400m cannot fit in an 800m return loop; show the real route length rather than promise ten minutes.
- Only pedestrian-routed paths may be presented as routes through a park. Unverified fallback loops must be labeled schematic, not directions.
- Movement safety answers stay in localStorage only and must never enter analytics or server requests. A doctor's exercise restriction takes priority over pain and location: offer no routine or movement curve reduction.
- Non-walking movement routines must not count as post-meal walks in Week. All movement reductions remain illustrative, not exercise clearance or personalized medical advice.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
