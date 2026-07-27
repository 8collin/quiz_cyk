-- =====================================================================
-- Quiz — row level security.
--
-- The anon key is public: it ships inside the page and anyone can read
-- it. So every rule that matters has to hold here, in the database.
-- The previous version had none of this -- any player could have set
-- their own score with two lines in the console.
--
-- Baseline: players read, the host writes. The only thing a player may
-- write is a buzz row for themselves.
-- =====================================================================

alter table public.profile         enable row level security;
alter table public.game            enable row level security;
alter table public.question        enable row level security;
alter table public.question_answer enable row level security;
alter table public.participant     enable row level security;
alter table public.buzz            enable row level security;
alter table public.answer_log      enable row level security;

-- Helpers is_admin() / my_participant_id() are defined in 002_functions.sql,
-- because the functions there guard themselves with is_admin() too.

-- ---------------------------------------------------------------------
-- profile
--
-- Everyone signed in can see everyone's name (the scoreboard needs it).
-- You may rename yourself but not promote yourself: `role` is guarded
-- by the trigger below, because a WITH CHECK clause cannot compare
-- against the row's previous value.
-- ---------------------------------------------------------------------
create policy profile_select_authenticated on public.profile
    for select to authenticated
    using (true);

create policy profile_update_self on public.profile
    for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

create policy profile_admin_all on public.profile
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.role is distinct from old.role and not public.is_admin() then
        raise exception 'role change not allowed' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

create trigger guard_profile_role_before_update
    before update on public.profile
    for each row
    execute function public.guard_profile_role();

-- ---------------------------------------------------------------------
-- game / question: readable by all players, writable by the host only
-- ---------------------------------------------------------------------
create policy game_select_authenticated on public.game
    for select to authenticated
    using (true);

create policy game_admin_all on public.game
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy question_select_authenticated on public.question
    for select to authenticated
    using (true);

create policy question_admin_all on public.question
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- question_answer: the reveal, enforced in the database
--
-- A player may read an answer only while it is the current question AND
-- the host has flipped show_answer. Before that the row simply does not
-- exist as far as the player's session is concerned -- no amount of
-- poking at the console brings it back.
-- ---------------------------------------------------------------------
create policy question_answer_select_when_revealed on public.question_answer
    for select to authenticated
    using (
        exists (
            select 1
              from public.game g
             where g.current_question_id = question_answer.question_id
               and g.show_answer
        )
    );

create policy question_answer_admin_all on public.question_answer
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- participant: scores are read by everyone, changed only by the host
-- ---------------------------------------------------------------------
create policy participant_select_authenticated on public.participant
    for select to authenticated
    using (true);

create policy participant_admin_all on public.participant
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- buzz: the one thing a player writes
--
-- INSERT is allowed only for the player's own participant row. Deleting
-- is the host's call -- a player must not be able to free the slot for
-- someone else, or clear their own buzz to dodge the penalty.
-- ---------------------------------------------------------------------
create policy buzz_select_authenticated on public.buzz
    for select to authenticated
    using (true);

create policy buzz_insert_self on public.buzz
    for insert to authenticated
    with check (participant_id = public.my_participant_id(game_id));

create policy buzz_admin_all on public.buzz
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- answer_log: written by the host when scoring, read by everyone
-- ---------------------------------------------------------------------
create policy answer_log_select_authenticated on public.answer_log
    for select to authenticated
    using (true);

create policy answer_log_admin_all on public.answer_log
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Function execution
-- ---------------------------------------------------------------------
revoke execute on function public.freeze_thinking(uuid) from public, anon, authenticated;
revoke execute on function public.resume_thinking(uuid) from public, anon, authenticated;

grant execute on function public.server_now()           to authenticated;
grant execute on function public.think_now(uuid)        to authenticated;
grant execute on function public.reset_thinking(uuid)   to authenticated;
grant execute on function public.reduce_penalty(uuid)   to authenticated;
