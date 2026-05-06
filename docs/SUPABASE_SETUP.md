# Supabase setup (Repovesi Open)

## 1. Create a Supabase project
Create a new project in Supabase.

## 2. Apply the schema
In the Supabase dashboard go to **SQL Editor** and run:

`supabase/schema.sql`

This creates:
- `public.competitions`
- `public.competition_players` (the whitelist / invite list)
- `public.results` (submissions)
- `public.standings` (view for active competition standings)
- Row Level Security policies so only whitelisted players can submit and see their competition data
- Admin helpers:
  - `public.competition_players_with_names` view (player list with display names)
  - `public.set_active_competition(p_competition_id)` RPC (mark a competition active)

## 3. Create the competition
Example (adjust dates as needed):

```sql
insert into public.competitions (name, start_date, is_active)
values ('Repovesi Open', current_date, true);
```

Get the competition id:

```sql
select id, name from public.competitions;
```

## 4. Add players to the whitelist (invite/whitelist)
Players must be added to `public.competition_players` for the competition.

After a player signs in (with Supabase Auth magic link), you can find their user id in:
- Supabase dashboard -> **Authentication** -> Users

Then add them:

```sql
insert into public.competition_players (competition_id, user_id, role)
values ('<competition_id>', '<user_id>', 'player');
```

Optionally create an admin:
`role = 'admin'` (admin-management UI is not implemented in this starter scaffold yet; admin inserts can be done via Supabase dashboard/SQL for now).

## 5. Use the admin page
1. Sign in as the user you want to become an admin (magic link).
2. Add your account to the whitelist with `role = 'admin'` for the competition.
3. Open the app at `/admin`.

The starter admin UI manages the whitelist by `user_id` (UUID). Email-to-user_id lookup is not included in this scaffold; admins can copy `auth.users.id` from Supabase.

## 6. Configure frontend environment variables
In the app:
- `VITE_SUPABASE_URL` = your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = your Supabase anon public key

The starter code expects these in `.env` / Netlify environment variables.

