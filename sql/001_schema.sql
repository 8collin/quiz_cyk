-- =====================================================================
-- Quiz — schema, rewritten from scratch.
--
-- Design notes (differences from the previous single-file version):
--
--   * A `game` row replaces the old single `quiz_state` row with id = 1.
--     Several games can exist; finished ones stay as history.
--   * The current question is a foreign key, not a counter smuggled
--     inside the question text as "some text|||3|20".
--   * `game` no longer duplicates the question text / image. Clients
--     read the `question` row by id, so there is exactly one copy.
--   * A participant's jingle is `sound_key`, decoupled from the login.
--     Previously the file name had to equal the login, which meant
--     renaming a player silently broke their sound.
--   * Identity comes from Supabase Auth (`auth.users`), so passwords
--     are never stored or compared by us. See 002_rls.sql.
--
-- "Thinking time" axis T
-- ----------------------
-- Answer cooldowns are NOT measured in wall-clock time. They advance
-- along an axis T that only moves while nobody is answering, and
-- freezes while someone holds the buzzer -- so a player's penalty does
-- not burn away during a long answer.
--
--   T = think_base_ms + (think_since is null ? 0 : now() - think_since)
--
-- `think_since = null` means frozen. Both columns live on `game`.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profile: one row per authenticated user, mirrors auth.users
-- ---------------------------------------------------------------------
create table public.profile (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text        not null,
    role         text        not null default 'player'
                             check (role in ('admin', 'player')),
    created_at   timestamptz not null default now()
);

comment on table public.profile is
    'Application-level data for an authenticated user. Passwords live in auth.users, never here.';

-- ---------------------------------------------------------------------
-- game: one running quiz
-- ---------------------------------------------------------------------
create table public.game (
    id                  uuid primary key default gen_random_uuid(),
    title               text,
    status              text        not null default 'lobby'
                                    check (status in ('lobby', 'running', 'finished')),
    host_id             uuid        not null references public.profile (id),

    current_question_id uuid,       -- FK added after `question` exists
    show_answer         boolean     not null default false,

    -- Thinking-time axis (see header).
    think_base_ms       integer     not null default 0 check (think_base_ms >= 0),
    think_since         timestamptz,

    -- How much waiting one accepted answer adds, in ms. Per game, so a
    -- host can run a faster or slower round without touching code.
    penalty_step_ms     integer     not null default 5000 check (penalty_step_ms >= 0),

    created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- question: ordered list belonging to a game
-- ---------------------------------------------------------------------
create table public.question (
    id        uuid    primary key default gen_random_uuid(),
    game_id   uuid    not null references public.game (id) on delete cascade,
    position  integer not null check (position >= 0),
    text      text    not null default '',
    image_url text,

    unique (game_id, position)
);

create index question_game_position_idx on public.question (game_id, position);

-- ---------------------------------------------------------------------
-- question_answer: the answer, deliberately kept out of `question`
--
-- RLS is row-level, not column-level: anything a player may SELECT,
-- they may SELECT entirely. Keeping the answer in the same row as the
-- question would therefore hand it to every player through devtools
-- before the host reveals it -- which is exactly what the previous
-- version did by broadcasting a_text to everyone at all times.
--
-- Split out, the reveal becomes a policy: see 003_rls.sql.
-- ---------------------------------------------------------------------
create table public.question_answer (
    question_id uuid primary key references public.question (id) on delete cascade,
    text        text not null default '',
    image_url   text
);

alter table public.game
    add constraint game_current_question_fk
    foreign key (current_question_id) references public.question (id) on delete set null;

-- ---------------------------------------------------------------------
-- participant: someone playing a specific game
--
-- profile_id is nullable on purpose: the host can add an offline player
-- ("manual" in the old version) who has no account and is scored from
-- the host's screen.
-- ---------------------------------------------------------------------
create table public.participant (
    id               uuid    primary key default gen_random_uuid(),
    game_id          uuid    not null references public.game (id) on delete cascade,
    profile_id       uuid             references public.profile (id) on delete set null,
    display_name     text    not null,
    score            integer not null default 0,

    -- Deadline on the T axis (ms). The player may buzz once T passes it.
    penalty_until_ms integer not null default 0 check (penalty_until_ms >= 0),

    -- Jingle file name without extension, resolved to audio/<sound_key>.mp3.
    -- Null falls back to audio/default.mp3.
    sound_key        text,

    created_at       timestamptz not null default now(),

    unique (game_id, profile_id)
);

create index participant_game_idx on public.participant (game_id);

-- ---------------------------------------------------------------------
-- buzz: who is answering right now
--
-- At most one row per game. The unique index is the whole concurrency
-- story: every player INSERTs, exactly one wins, the losers get 23505.
-- Never resolve this race on the client.
-- ---------------------------------------------------------------------
create table public.buzz (
    id             uuid        primary key default gen_random_uuid(),
    game_id        uuid        not null references public.game (id) on delete cascade,
    participant_id uuid        not null references public.participant (id) on delete cascade,
    created_at     timestamptz not null default now()
);

create unique index buzz_one_per_game on public.buzz (game_id);

-- ---------------------------------------------------------------------
-- answer_log: accepted answers, the audit trail
--
-- Written when the host scores someone. `delta` records what the host
-- awarded (-1 / 0 / +1), so "answered but got nothing" stays visible.
-- ---------------------------------------------------------------------
create table public.answer_log (
    id             uuid        primary key default gen_random_uuid(),
    game_id        uuid        not null references public.game (id) on delete cascade,
    question_id    uuid        not null references public.question (id) on delete cascade,
    participant_id uuid        not null references public.participant (id) on delete cascade,
    delta          integer     not null default 0,
    created_at     timestamptz not null default now()
);

create index answer_log_question_idx on public.answer_log (question_id);

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.game;
alter publication supabase_realtime add table public.participant;
alter publication supabase_realtime add table public.buzz;
alter publication supabase_realtime add table public.answer_log;
