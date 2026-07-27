-- =====================================================================
-- Quiz — server-side functions and triggers.
--
-- Everything that must not be decided by the client lives here:
-- the authoritative clock, the thinking-time axis, and the check that
-- a player is actually allowed to buzz.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity helpers.
--
-- security definer so they can read `profile` / `participant` without
-- re-entering those tables' own RLS policies, which would recurse.
-- Used both by the policies in 003_rls.sql and by the guards below.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profile
         where id = auth.uid() and role = 'admin'
    );
$$;

create or replace function public.my_participant_id(p_game_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select id from public.participant
     where game_id = p_game_id and profile_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Authoritative clock.
--
-- Clients call this once at startup and keep the offset. Phone clocks
-- drift by minutes; every cooldown is compared against server time.
-- ---------------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
    select now();
$$;

-- ---------------------------------------------------------------------
-- Current value of the thinking-time axis T for a game, in ms.
-- Mirrors the client-side formula in js/timing.js -- keep both in sync.
-- ---------------------------------------------------------------------
create or replace function public.think_now(p_game_id uuid)
returns bigint
language sql
stable
as $$
    select g.think_base_ms
         + case
               when g.think_since is null then 0
               else (extract(epoch from (now() - g.think_since)) * 1000)::bigint
           end
      from public.game g
     where g.id = p_game_id;
$$;

-- ---------------------------------------------------------------------
-- Freeze / resume the axis.
--
-- Freezing folds elapsed time into think_base_ms and clears think_since.
-- Resuming stamps think_since with now(). Both are idempotent, so the
-- triggers below can call them without checking the current state.
-- ---------------------------------------------------------------------
create or replace function public.freeze_thinking(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.game
       set think_base_ms = public.think_now(p_game_id),
           think_since   = null
     where id = p_game_id
       and think_since is not null;
end;
$$;

create or replace function public.resume_thinking(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.game
       set think_since = now()
     where id = p_game_id
       and think_since is null;
end;
$$;

-- ---------------------------------------------------------------------
-- Reset the axis and every personal cooldown. Called when the host
-- moves to another question or restarts the game.
--
-- Note the WHERE clauses: Supabase runs with pg_safeupdate, which
-- rejects UPDATE/DELETE without one. The previous version tripped over
-- exactly this and the reset had to be moved to the client.
-- ---------------------------------------------------------------------
create or replace function public.reset_thinking(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- security definer bypasses RLS, so the role check has to be here.
    if not public.is_admin() then
        raise exception 'admin only' using errcode = 'P0001';
    end if;

    delete from public.buzz where game_id = p_game_id;

    update public.participant
       set penalty_until_ms = 0
     where game_id = p_game_id;

    update public.game
       set think_base_ms = 0,
           think_since   = now()
     where id = p_game_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Undo one accidental buzz for a participant: drop one penalty step and
-- release the answering slot if they are holding it.
--
-- Both halves matter. Clearing only the penalty leaves the player stuck
-- as "answering"; clearing only the slot leaves them waiting for a
-- penalty they never earned.
-- ---------------------------------------------------------------------
create or replace function public.reduce_penalty(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_game_id uuid;
    v_step    integer;
begin
    -- security definer bypasses RLS, so the role check has to be here.
    if not public.is_admin() then
        raise exception 'admin only' using errcode = 'P0001';
    end if;

    select p.game_id, g.penalty_step_ms
      into v_game_id, v_step
      from public.participant p
      join public.game g on g.id = p.game_id
     where p.id = p_participant_id;

    if v_game_id is null then
        return;
    end if;

    update public.participant
       set penalty_until_ms = greatest(0, penalty_until_ms - v_step)
     where id = p_participant_id;

    delete from public.buzz
     where participant_id = p_participant_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Trigger: a buzz is only allowed once the player's cooldown has
-- elapsed on the T axis.
--
-- The client already hides the button, but that is cosmetic -- this is
-- the check that actually holds when someone's clock is wrong or they
-- poke the API directly.
-- ---------------------------------------------------------------------
create or replace function public.buzz_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_until integer;
    v_now   bigint;
begin
    select penalty_until_ms into v_until
      from public.participant
     where id = new.participant_id;

    v_now := public.think_now(new.game_id);

    if v_until is not null and v_now < v_until then
        raise exception 'penalty_active: % ms left', (v_until - v_now)
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

create trigger buzz_guard_before_insert
    before insert on public.buzz
    for each row
    execute function public.buzz_guard();

-- ---------------------------------------------------------------------
-- Trigger: the axis freezes while someone is answering and resumes when
-- the slot is released, so cooldowns only tick during open play.
-- ---------------------------------------------------------------------
create or replace function public.buzz_freeze_axis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        perform public.freeze_thinking(new.game_id);
    else
        perform public.resume_thinking(old.game_id);
    end if;
    return null;
end;
$$;

create trigger buzz_freeze_axis_after
    after insert or delete on public.buzz
    for each row
    execute function public.buzz_freeze_axis();

-- ---------------------------------------------------------------------
-- Trigger: an accepted answer costs the answering player one penalty
-- step, measured from the current position of the axis.
-- ---------------------------------------------------------------------
create or replace function public.answer_applies_penalty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_step integer;
begin
    select penalty_step_ms into v_step
      from public.game
     where id = new.game_id;

    update public.participant
       set penalty_until_ms = public.think_now(new.game_id) + coalesce(v_step, 0)
     where id = new.participant_id;

    return null;
end;
$$;

create trigger answer_applies_penalty_after_insert
    after insert on public.answer_log
    for each row
    execute function public.answer_applies_penalty();

-- ---------------------------------------------------------------------
-- Trigger: create a profile row whenever someone signs up, so the app
-- never has to deal with an authenticated user that has no profile.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profile (id, display_name, role)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', 'Игрок'),
        'player'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();
