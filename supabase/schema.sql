-- Repovesi Open - Supabase schema
-- Apply this in Supabase SQL editor.

create extension if not exists pgcrypto;

-- Competitions (you can have multiple, but one or more can be marked as active)
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Whitelist of users allowed to submit/view results for each competition
create table if not exists public.competition_players (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'player' check (role in ('player', 'admin')),
  created_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

-- Player submissions (players can submit multiple times; points are summed in standings)
create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points >= 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists competition_players_user_id_idx on public.competition_players(user_id);
create index if not exists competition_players_competition_id_idx on public.competition_players(competition_id);
create index if not exists results_user_id_idx on public.results(user_id);
create index if not exists results_competition_id_idx on public.results(competition_id);
create index if not exists results_created_at_idx on public.results(created_at);

-- ------------------------
-- Betting + rounds
-- ------------------------

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  round_number integer not null,
  status text not null default 'open' check (status in ('open', 'closed', 'settled')),
  created_at timestamptz not null default now(),
  unique (competition_id, round_number)
);

create index if not exists rounds_competition_id_idx on public.rounds(competition_id);
create index if not exists rounds_status_idx on public.rounds(status);

create table if not exists public.round_results (
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  points integer not null check (points >= 0),
  created_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

create index if not exists round_results_round_id_idx on public.round_results(round_id);
create index if not exists round_results_user_id_idx on public.round_results(user_id);

create table if not exists public.competition_wallets (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance numeric(12,2) not null default 100.00,
  created_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create table if not exists public.competition_odds (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_odds numeric(6,2) not null,
  updated_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, -- bettor
  pick_user_id uuid not null references auth.users(id) on delete cascade, -- predicted winner
  amount numeric(12,2) not null check (amount > 0),
  odds_snapshot numeric(6,2) not null,
  created_at timestamptz not null default now(),
  settled boolean not null default false,
  won boolean,
  payout numeric(12,2) not null default 0.00
);

create index if not exists bets_round_id_idx on public.bets(round_id);
create index if not exists bets_user_id_idx on public.bets(user_id);

create or replace function public.seed_initial_odds(p_competition_id uuid, p_user_id uuid)
returns numeric
language sql
immutable
as $$
  select round((7.00 + (abs(hashtext(p_user_id::text)) % 100) / 100.0)::numeric, 2);
$$;

-- Add skill_level column to competition_players
alter table public.competition_players
add column if not exists skill_level numeric(4,2) default null;

-- Function to assign random skill levels (7.00-7.99) to players without them
create or replace function public.assign_skill_levels(p_competition_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.competition_players
  set skill_level = round((7.00 + (abs(hashtext(user_id::text)) % 100) / 100.0)::numeric, 2)
  where competition_id = p_competition_id
    and skill_level is null;
end;
$$;

-- Function to calculate skill level based on per-round performance
create or replace function public.calculate_skill_level(p_competition_id uuid, p_user_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_skill numeric;
  v_skill_delta numeric;
begin
  -- Start with base skill of 7.0
  v_skill := 7.0;
  
  -- For each round, add or subtract based on points earned
  -- 6+ points: +0.05 per point (10 pts = +0.5, 20 pts = +1.0, etc)
  -- 5 or less: -0.3 per round
  select coalesce(
    sum(case
      when points >= 6 then (points::numeric / 10.0 * 0.5)
      when points <= 5 then -0.3
      else 0
    end),
    0
  ) into v_skill_delta
  from public.round_results rr
  join public.rounds r on r.id = rr.round_id
  where r.competition_id = p_competition_id
    and rr.user_id = p_user_id;
  
  v_skill := v_skill + v_skill_delta;
  
  -- Cap at 10.0 max and 5.0 min
  return round(least(10.0, greatest(5.0, v_skill)), 2);
end;
$$;

-- Function to calculate odds based on skill levels
create or replace function public.calculate_skill_based_odds(p_competition_id uuid, p_user_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_skill numeric;
  v_avg_skill numeric;
  v_odds numeric;
begin
  -- Calculate skill level based on accumulated points
  select public.calculate_skill_level(p_competition_id, p_user_id) into v_skill;

  if v_skill is null then
    return 5.00; -- fallback
  end if;

  -- Calculate average skill level of all players in competition
  select avg(public.calculate_skill_level(p_competition_id, cp.user_id)) into v_avg_skill
  from public.competition_players cp
  where cp.competition_id = p_competition_id;

  if v_avg_skill is null or v_avg_skill = 0 then
    return 5.00; -- fallback
  end if;

  -- Calculate odds: 1 / ((skill_level/100) / (avg_skill/100)) = avg_skill / skill_level
  v_odds := v_avg_skill / v_skill;

  -- Add small deterministic jitter to avoid identical odds
  v_odds := v_odds + ((abs(hashtext(p_user_id::text)) % 20) / 100.0);

  -- Clamp between reasonable bounds
  return least(12.00, greatest(1.50, round(v_odds, 2)));
end;
$$;

-- When a player is whitelisted, create their wallet + initial odds.
create or replace function public.handle_competition_player_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.competition_wallets (competition_id, user_id, balance)
  values (new.competition_id, new.user_id, 100.00)
  on conflict (competition_id, user_id) do nothing;

  insert into public.competition_odds (competition_id, user_id, current_odds)
  values (new.competition_id, new.user_id, public.calculate_skill_based_odds(new.competition_id, new.user_id))
  on conflict (competition_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_competition_player_added on public.competition_players;
create trigger on_competition_player_added
after insert on public.competition_players
for each row execute procedure public.handle_competition_player_added();

-- Public profiles (username directory)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Auto-create profile rows when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_display text;
begin
  v_username := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_display := nullif(trim(new.raw_user_meta_data->>'full_name'), '');

  if v_username is null then
    -- Fall back: use the email local-part as username.
    v_username := split_part(new.email, '@', 1);
  end if;
  if v_display is null then
    v_display := v_username;
  end if;

  insert into public.profiles (user_id, username, display_name)
  values (new.id, v_username, v_display)
  on conflict (user_id) do update
    set username = excluded.username,
        display_name = excluded.display_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- View: Active competition standings (sorted by total_points in the frontend)
-- Note: when changing view columns, dropping avoids "cannot change name of view column" errors.
drop view if exists public.standings;
create view public.standings as
select
  cp.competition_id,
  cp.user_id as player_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as player_name,
  coalesce(sum(rr.points), 0)::int as total_points,
  count(distinct rr.round_id)::int as rounds_count,
  max(r.created_at) as last_submission_at,
  coalesce(max(rr.points), 0)::int as best_round_points,
  coalesce(avg(rr.points), 0)::numeric(10,2) as avg_round_points,
  public.calculate_skill_level(cp.competition_id, cp.user_id)::numeric(4,2) as skill_level,
  coalesce(o.current_odds, public.calculate_skill_based_odds(cp.competition_id, cp.user_id))::numeric(6,2) as current_odds,
  coalesce(w.balance, 100.00)::numeric(12,2) as balance,
  (
    select coalesce(max(payout), 0)::numeric(12,2)
    from public.bets
    where competition_id = cp.competition_id
      and user_id = cp.user_id
      and settled = true
      and won = true
  )::numeric(12,2) as best_payout
from public.competition_players cp
join public.competitions c on c.id = cp.competition_id
join auth.users u on u.id = cp.user_id
left join public.round_results rr
  on rr.user_id = cp.user_id
left join public.rounds r
  on r.id = rr.round_id
 and r.competition_id = cp.competition_id
left join public.competition_odds o
  on o.competition_id = cp.competition_id
 and o.user_id = cp.user_id
left join public.competition_wallets w
  on w.competition_id = cp.competition_id
 and w.user_id = cp.user_id
where c.is_active = true
group by
  cp.competition_id,
  cp.user_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email),
  o.current_odds,
  w.balance;

-- View: Competition whitelist directory (used by admin page)
create or replace view public.competition_players_with_names as
select
  cp.competition_id,
  cp.user_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as player_name,
  cp.role
from public.competition_players cp
join auth.users u on u.id = cp.user_id;

-- ------------------------
-- Row Level Security (RLS)
-- ------------------------

alter table public.competitions enable row level security;
alter table public.competition_players enable row level security;
alter table public.results enable row level security;
alter table public.profiles enable row level security;
alter table public.rounds enable row level security;
alter table public.round_results enable row level security;
alter table public.competition_wallets enable row level security;
alter table public.competition_odds enable row level security;
alter table public.bets enable row level security;

-- Helper functions (SECURITY DEFINER) to avoid RLS recursion in policies.
create or replace function public.is_competition_admin(p_competition_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competition_players cp
    where cp.competition_id = p_competition_id
      and cp.user_id = auth.uid()
      and cp.role = 'admin'
  );
$$;

create or replace function public.is_active_competition_member(p_competition_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competition_players cp
    join public.competitions c on c.id = cp.competition_id
    where cp.competition_id = p_competition_id
      and cp.user_id = auth.uid()
      and c.is_active = true
  );
$$;

grant execute on function public.is_competition_admin(uuid) to authenticated;
grant execute on function public.is_active_competition_member(uuid) to authenticated;

create or replace function public.active_competition_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.competitions where is_active = true order by start_date desc limit 1;
$$;

grant execute on function public.active_competition_id() to authenticated;

-- Competitions: anyone signed in can read active competitions,
-- and competition admins can read their competitions even if inactive.
drop policy if exists "read active competitions" on public.competitions;
create policy "read active competitions"
on public.competitions
for select
to authenticated
using (
  is_active = true
  or public.is_competition_admin(id)
);

-- Competition players:
-- Members can read the whitelist for active competitions.
-- Admins can read the whitelist for their competitions even if inactive.
drop policy if exists "members can view competition players" on public.competition_players;
create policy "members can view competition players"
on public.competition_players
for select
to authenticated
using (
  public.is_active_competition_member(competition_id)
  or public.is_competition_admin(competition_id)
);

-- Results:
-- Members of an active competition can read all results in that competition.
drop policy if exists "members can view results for active competitions" on public.results;
create policy "members can view results for active competitions"
on public.results
for select
to authenticated
using (
  public.is_active_competition_member(competition_id)
);

-- Insert:
-- Players can insert results only for themselves and only into competitions they are whitelisted for.
drop policy if exists "players can insert own results" on public.results;
create policy "players can insert own results"
on public.results
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_competition_member(competition_id)
);

-- ---- Rounds / bets / wallets RLS ----

drop policy if exists "members can view rounds" on public.rounds;
create policy "members can view rounds"
on public.rounds
for select
to authenticated
using (public.is_active_competition_member(competition_id) or public.is_competition_admin(competition_id));

drop policy if exists "members can view round results" on public.round_results;
create policy "members can view round results"
on public.round_results
for select
to authenticated
using (
  exists (
    select 1
    from public.rounds r
    where r.id = round_results.round_id
      and (public.is_active_competition_member(r.competition_id) or public.is_competition_admin(r.competition_id))
  )
);

drop policy if exists "admins can write round results" on public.round_results;
create policy "admins can write round results"
on public.round_results
for insert
to authenticated
with check (
  exists (
    select 1
    from public.rounds r
    where r.id = round_results.round_id
      and public.is_competition_admin(r.competition_id)
  )
);

drop policy if exists "admins can update round results" on public.round_results;
create policy "admins can update round results"
on public.round_results
for update
to authenticated
using (
  exists (
    select 1
    from public.rounds r
    where r.id = round_results.round_id
      and public.is_competition_admin(r.competition_id)
  )
)
with check (
  exists (
    select 1
    from public.rounds r
    where r.id = round_results.round_id
      and public.is_competition_admin(r.competition_id)
  )
);

drop policy if exists "members can view wallets" on public.competition_wallets;
create policy "members can view wallets"
on public.competition_wallets
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "members can view odds" on public.competition_odds;
create policy "members can view odds"
on public.competition_odds
for select
to authenticated
using (
  public.is_active_competition_member(competition_id) or public.is_competition_admin(competition_id)
);

drop policy if exists "members can view bets" on public.bets;
create policy "members can view bets"
on public.bets
for select
to authenticated
using (
  public.is_active_competition_member(competition_id)
  or public.is_competition_admin(competition_id)
);


-- ------------------------
-- Admin-only whitelist management
-- ------------------------

drop policy if exists "admins can insert competition players" on public.competition_players;
create policy "admins can insert competition players"
on public.competition_players
for insert
to authenticated
with check (
  public.is_competition_admin(competition_id)
);

drop policy if exists "admins can update competition players" on public.competition_players;
create policy "admins can update competition players"
on public.competition_players
for update
to authenticated
using (
  public.is_competition_admin(competition_id)
)
with check (
  public.is_competition_admin(competition_id)
);

drop policy if exists "admins can delete competition players" on public.competition_players;
create policy "admins can delete competition players"
on public.competition_players
for delete
to authenticated
using (
  public.is_competition_admin(competition_id)
);

-- ------------------------
-- RPC: Activate competition (keeps ordering simple)
-- ------------------------

create or replace function public.set_active_competition(p_competition_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Authorization: caller must be an admin for the target competition.
  if not exists (
    select 1
    from public.competition_players cp
    where cp.competition_id = p_competition_id
      and cp.user_id = auth.uid()
      and cp.role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  update public.competitions
  set is_active = false
  where is_active = true;

  update public.competitions
  set is_active = true
  where id = p_competition_id;
end;
$$;

grant execute on function public.set_active_competition(uuid) to authenticated;

-- ------------------------
-- RPC: Create competition (admin-only)
-- ------------------------

create or replace function public.create_competition(
  p_name text,
  p_start_date date default current_date,
  p_end_date date default null,
  p_make_active boolean default false
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  -- Authorization: caller must already be an admin of at least one competition.
  if not exists (
    select 1
    from public.competition_players cp
    where cp.user_id = auth.uid()
      and cp.role = 'admin'
  ) then
    raise exception 'Not authorized';
  end if;

  insert into public.competitions (name, start_date, end_date, is_active)
  values (p_name, coalesce(p_start_date, current_date), p_end_date, false)
  returning id into v_id;

  -- Make the creator an admin of the new competition.
  insert into public.competition_players (competition_id, user_id, role)
  values (v_id, auth.uid(), 'admin')
  on conflict (competition_id, user_id) do update set role = 'admin';

  if p_make_active then
    update public.competitions
    set is_active = false
    where is_active = true;

    update public.competitions
    set is_active = true
    where id = v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.create_competition(text, date, date, boolean) to authenticated;

-- ------------------------
-- RPC: Create round (admin-only)
-- ------------------------

create or replace function public.create_round(p_competition_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_id uuid;
begin
  if not public.is_competition_admin(p_competition_id) then
    raise exception 'Not authorized';
  end if;

  -- Close any previous open round for this competition.
  update public.rounds
  set status = 'closed'
  where competition_id = p_competition_id
    and status = 'open';

  select coalesce(max(round_number), 0) + 1
  into v_next
  from public.rounds
  where competition_id = p_competition_id;

  insert into public.rounds (competition_id, round_number, status)
  values (p_competition_id, v_next, 'open')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_round(uuid) to authenticated;

-- ------------------------
-- RPC: Place bet (player)
-- ------------------------

create or replace function public.place_bet(
  p_round_id uuid,
  p_pick_user_id uuid,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp uuid;
  v_status text;
  v_balance numeric(12,2);
  v_odds numeric(6,2);
  v_id uuid;
  v_existing_bets integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  select r.competition_id, r.status
  into v_comp, v_status
  from public.rounds r
  where r.id = p_round_id;

  if v_comp is null then
    raise exception 'Round not found';
  end if;

  if v_status <> 'open' then
    raise exception 'Betting is closed for this round';
  end if;

  if not public.is_active_competition_member(v_comp) then
    raise exception 'Not authorized';
  end if;

  -- Limit: max 3 bets per player per round.
  select count(*)::int
  into v_existing_bets
  from public.bets b
  where b.round_id = p_round_id
    and b.user_id = auth.uid();
  if v_existing_bets >= 3 then
    raise exception 'Bet limit reached: max 3 bets per round';
  end if;

  -- Backfill safety for players created before wallet/odds triggers existed.
  insert into public.competition_wallets (competition_id, user_id, balance)
  values (v_comp, auth.uid(), 100.00)
  on conflict (competition_id, user_id) do nothing;

  insert into public.competition_odds (competition_id, user_id, current_odds)
  values (v_comp, auth.uid(), public.calculate_skill_based_odds(v_comp, auth.uid()))
  on conflict (competition_id, user_id) do nothing;

  insert into public.competition_odds (competition_id, user_id, current_odds)
  values (v_comp, p_pick_user_id, public.calculate_skill_based_odds(v_comp, p_pick_user_id))
  on conflict (competition_id, user_id) do nothing;

  -- pick must be a whitelisted player in this competition
  if not exists (
    select 1
    from public.competition_players cp
    where cp.competition_id = v_comp
      and cp.user_id = p_pick_user_id
  ) then
    raise exception 'Invalid pick';
  end if;

  select w.balance into v_balance
  from public.competition_wallets w
  where w.competition_id = v_comp
    and w.user_id = auth.uid();

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;
  if v_balance < p_amount then
    raise exception 'Insufficient dubloons';
  end if;

  select o.current_odds into v_odds
  from public.competition_odds o
  where o.competition_id = v_comp
    and o.user_id = p_pick_user_id;

  if v_odds is null then
    v_odds := public.calculate_skill_based_odds(v_comp, p_pick_user_id);
  end if;

  -- Deduct immediately.
  update public.competition_wallets
  set balance = balance - p_amount
  where competition_id = v_comp
    and user_id = auth.uid();

  insert into public.bets (competition_id, round_id, user_id, pick_user_id, amount, odds_snapshot)
  values (v_comp, p_round_id, auth.uid(), p_pick_user_id, round(p_amount,2), v_odds)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.place_bet(uuid, uuid, numeric) to authenticated;

-- ------------------------
-- RPC: Submit round results + settle bets + update odds (admin-only)
-- p_results_json: [{"user_id":"...uuid...","points":12}, ...]
-- ------------------------

create or replace function public.submit_round_results(
  p_round_id uuid,
  p_results_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp uuid;
  v_winner uuid;
  v_max integer;
  v_max_total integer;
begin
  select competition_id into v_comp
  from public.rounds
  where id = p_round_id;

  if v_comp is null then
    raise exception 'Round not found';
  end if;

  if not public.is_competition_admin(v_comp) then
    raise exception 'Not authorized';
  end if;

  -- Upsert results
  insert into public.round_results (round_id, user_id, points)
  select
    p_round_id,
    (x->>'user_id')::uuid,
    greatest(0, (x->>'points')::int)
  from jsonb_array_elements(p_results_json) x
  on conflict (round_id, user_id) do update
    set points = excluded.points;

  update public.rounds
  set status = 'closed'
  where id = p_round_id;

  -- Winner = max points in the round (ties: lowest uuid deterministic)
  select rr.user_id, rr.points
  into v_winner, v_max
  from public.round_results rr
  where rr.round_id = p_round_id
  order by rr.points desc, rr.user_id asc
  limit 1;

  -- Settle bets for this round (amount already deducted at placement)
  update public.bets b
  set
    settled = true,
    won = (b.pick_user_id = v_winner),
    payout = case when b.pick_user_id = v_winner then round(b.amount * b.odds_snapshot, 2) else 0.00 end
  where b.round_id = p_round_id
    and b.settled = false;

  -- Payout winners
  update public.competition_wallets w
  set balance = w.balance + s.payout
  from (
    select competition_id, user_id, sum(payout)::numeric(12,2) as payout
    from public.bets
    where round_id = p_round_id
      and settled = true
      and won = true
    group by competition_id, user_id
  ) s
  where w.competition_id = s.competition_id
    and w.user_id = s.user_id;

  update public.rounds
  set status = 'settled'
  where id = p_round_id;

  -- Update odds based on skill levels (not points)
  insert into public.competition_odds (competition_id, user_id, current_odds, updated_at)
  select
    v_comp,
    cp.user_id,
    public.calculate_skill_based_odds(v_comp, cp.user_id),
    now()
  from public.competition_players cp
  where cp.competition_id = v_comp
  on conflict (competition_id, user_id) do update
    set current_odds = excluded.current_odds,
        updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.submit_round_results(uuid, jsonb) to authenticated;

-- ------------------------
-- RPC: Delete round (admin-only)
-- Removes round results and bets for the round.
-- If round was settled, payouts are reversed first.
-- Bet stake amount is always refunded to bettors.
-- ------------------------

create or replace function public.delete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp uuid;
begin
  select competition_id into v_comp
  from public.rounds
  where id = p_round_id;

  if v_comp is null then
    raise exception 'Round not found';
  end if;

  if not public.is_competition_admin(v_comp) then
    raise exception 'Not authorized';
  end if;

  -- Reverse payouts for already-settled winning bets.
  update public.competition_wallets w
  set balance = w.balance - s.payout_sum
  from (
    select b.competition_id, b.user_id, coalesce(sum(b.payout), 0)::numeric(12,2) as payout_sum
    from public.bets b
    where b.round_id = p_round_id
      and b.settled = true
      and b.won = true
      and b.payout > 0
    group by b.competition_id, b.user_id
  ) s
  where w.competition_id = s.competition_id
    and w.user_id = s.user_id;

  -- Refund bet stakes for all bets in that round.
  update public.competition_wallets w
  set balance = w.balance + s.amount_sum
  from (
    select b.competition_id, b.user_id, coalesce(sum(b.amount), 0)::numeric(12,2) as amount_sum
    from public.bets b
    where b.round_id = p_round_id
    group by b.competition_id, b.user_id
  ) s
  where w.competition_id = s.competition_id
    and w.user_id = s.user_id;

  -- Remove round (cascades to round_results + bets).
  delete from public.rounds
  where id = p_round_id;

  -- Recalculate odds based on skill levels
  insert into public.competition_odds (competition_id, user_id, current_odds, updated_at)
  select
    v_comp,
    cp.user_id,
    public.calculate_skill_based_odds(v_comp, cp.user_id),
    now()
  from public.competition_players cp
  where cp.competition_id = v_comp
  on conflict (competition_id, user_id) do update
    set current_odds = excluded.current_odds,
        updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.delete_round(uuid) to authenticated;

-- ------------------------
-- Profiles RLS
-- ------------------------

drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile"
on public.profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can view all profiles" on public.profiles;
create policy "admins can view all profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.competition_players cp
    where cp.user_id = auth.uid()
      and cp.role = 'admin'
  )
);

-- ------------------------
-- Invites by username (Fix: whitelist before first login)
-- ------------------------

create table if not exists public.competition_invites (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  username text not null, -- normalized (e.g. "anton-s")
  role text not null default 'player' check (role in ('player', 'admin')),
  created_at timestamptz not null default now(),
  primary key (competition_id, username)
);

alter table public.competition_invites enable row level security;

-- Admins can manage invites.
drop policy if exists "admins can view competition_invites" on public.competition_invites;
create policy "admins can view competition_invites"
on public.competition_invites
for select
to authenticated
using (public.is_competition_admin(competition_id));

drop policy if exists "admins can insert competition_invites" on public.competition_invites;
create policy "admins can insert competition_invites"
on public.competition_invites
for insert
to authenticated
with check (public.is_competition_admin(competition_id));

drop policy if exists "admins can update competition_invites" on public.competition_invites;
create policy "admins can update competition_invites"
on public.competition_invites
for update
to authenticated
using (public.is_competition_admin(competition_id))
with check (public.is_competition_admin(competition_id));

drop policy if exists "admins can delete competition_invites" on public.competition_invites;
create policy "admins can delete competition_invites"
on public.competition_invites
for delete
to authenticated
using (public.is_competition_admin(competition_id));

-- When a user first signs up (profile created), automatically add them to any competition invites.
create or replace function public.handle_profile_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.competition_players (competition_id, user_id, role)
  select
    ci.competition_id,
    new.user_id,
    ci.role
  from public.competition_invites ci
  where ci.username = new.username
  on conflict (competition_id, user_id) do update
    set role = excluded.role;

  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
after insert on public.profiles
for each row execute procedure public.handle_profile_invites();

drop trigger if exists on_profile_updated on public.profiles;
create trigger on_profile_updated
after update on public.profiles
for each row execute procedure public.handle_profile_invites();


