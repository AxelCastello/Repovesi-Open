# Repovesi Open

A simple React + Supabase app with:
- `Standings` page (podium + rankings + current odds)
- `Wager` page (players place multiple bets per open round, shows remaining dubloons)
- `Admin` page (`/admin`) to manage the competition whitelist
- `Admin` round controls (open round, submit points, settle bets/odds)

Hosted on Netlify (static frontend). Supabase provides Auth + database + RLS.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` from the example:
   ```bash
   cp .env.example .env
   ```
   Then fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

3. Start dev server:
   ```bash
   npm run dev
   ```

## Database setup (Supabase)

Follow `docs/SUPABASE_SETUP.md`, then apply:
`supabase/schema.sql`

Note: admins manage the whitelist via `user_id` (UUID). Email-to-user_id lookup is not included in this scaffold.

## Betting flow

- At competition whitelist time, each player gets:
  - `100` starting dubloons (`competition_wallets`)
  - initial odds in ~`5.00 - 5.99` (`competition_odds`)
- Admin opens a round from `/admin`
- Players place one or many wagers from `/bet`
- Admin submits round points from `/admin`, which:
  - settles bets (winner gets `amount * odds_snapshot`)
  - updates wallets
  - updates odds for next rounds based on cumulative points

## Deploy to Netlify

1. Create a Netlify site connected to this repo.
2. Netlify build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Add environment variables in Netlify:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Make sure you applied `supabase/schema.sql` and created the competition + whitelist rows.

