# MySoko

MySoko is an online marketplace connecting buyers and sellers in Kenya, covering consumer electronics, clothing, household goods and small services. Listings, in-app messaging, checkout and seller payouts all run through the platform.

## Tech stack

- SvelteKit 2 with TypeScript, server-side rendered
- Supabase: PostgreSQL, authentication, realtime and file storage
- Paystack for payments, Inngest for background jobs, Resend for email
- Deployed on Vercel

## Running the backend

Prerequisites: Node.js 22, npm, and Docker, which the Supabase CLI uses to run the local database.

```bash
npm install
cp .env.example .env   # then fill in the values
npm run db:start       # start the local Supabase stack
npm run db:reset       # apply all migrations
npm run dev            # serve on http://localhost:5173
```

The four required environment variables are:

| Variable                    | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `PUBLIC_SUPABASE_URL`       | Supabase project URL                    |
| `PUBLIC_SUPABASE_ANON_KEY`  | Publishable key, used in the browser    |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key, used on the server only     |
| `RESEND_API_KEY`            | API key for sending transactional email |

The Paystack, Inngest and Africa's Talking keys are optional. See `.env.example` for the full template.

## The database

PostgreSQL, hosted by Supabase. Seventeen tables cover profiles, listings and their images, categories, conversations and messages, orders and payments, payouts, reviews, boosts, disputes, notifications, and an administrative audit log.

Row level security is enabled on every table, so a query returns only the rows the signed-in user is permitted to see. The schema is defined by the SQL migration files in `supabase/migrations`, which `npm run db:reset` applies in order.

## Statistics

The application does not expose a dedicated statistics API. SvelteKit serves page data from server `load` functions, which run on the server and pass their results directly to the page, so aggregate figures are computed there rather than behind a REST route.

The clearest example is the admin dashboard at `/admin`. It displays five live figures: open disputes, removed listings, hidden reviews, active boosts, and recorded administrative actions.

Two small JSON endpoints do exist, `GET /api/unread-count` and `GET /api/notification-count`. Each returns a single count in the form `{ "count": 7 }`, used by the header badges so they can refresh without re-running the whole page load.

## How the backend retrieves the statistics

The dashboard load in `src/routes/(protected)/admin/+page.server.ts` issues five counting queries in parallel, one per figure:

```ts
const [openDisputes, removedListings, hiddenReviews, activeBoosts, recentActions] =
	await Promise.all([
		count(
			supabase
				.from('disputes')
				.select('id', { count: 'exact', head: true })
				.in('status', ['open', 'under_review'])
		)
		// ... four more, one for each figure
	]);

return { openDisputes, removedListings, hiddenReviews, activeBoosts, recentActions };
```

`count: 'exact'` asks PostgreSQL for a row count, and `head: true` suppresses the rows themselves, so the database returns a number rather than a list of records. The first query above is equivalent to:

```sql
select count(*)
  from public.disputes
 where status in ('open', 'under_review');
```

The queries run through the session client, which means they execute as the signed-in user and row level security applies. Each of these tables admits administrators through its own policy, so the security check sits in the database rather than only in the route guard.

The load returns the five numbers as an object, SvelteKit passes it to the page as `data`, and the page renders each one as a card. The figures are counted from the tables on every request. None is stored in a column, cached, or hardcoded.

## Current state

- Paystack runs in test mode. A mock client replaces it locally when `PAYSTACK_MOCK=1`.
- Email is sent from Resend's shared test domain, which delivers only to the Resend account's own verified address.
- This repository does not include automated test suites. The available checks are `npm run lint`, `npm run check` and `npm run build`.
