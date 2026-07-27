-- =====================================================================
-- Викторина — схема, написанная с нуля.
--
-- Чем отличается от предыдущей версии (одного файла cyk.html):
--
--   * Строка `game` вместо единственной строки quiz_state с id = 1.
--     Игр может быть несколько, доигранные остаются как история.
--   * Текущий вопрос — внешний ключ, а не счётчик, спрятанный внутрь
--     текста вопроса в виде "какой-то текст|||3|20".
--   * `game` больше не дублирует текст и картинку вопроса. Клиент
--     читает строку `question` по id, то есть копия ровно одна.
--   * Джингл участника — это `sound_key`, отвязанный от логина. Раньше
--     имя файла обязано было совпадать с логином, поэтому
--     переименование игрока молча ломало ему звук.
--   * Личность берётся из Supabase Auth (`auth.users`), так что пароли
--     мы не храним и не сравниваем. См. 003_rls.sql.
--
-- Ось «времени размышления» T
-- ---------------------------
-- Кулдауны считаются НЕ по настенным часам, а по оси T, которая идёт
-- только пока никто не отвечает, и замерзает, пока кто-то держит
-- буззер, — чтобы штраф игрока не сгорал впустую за время чужого
-- двухминутного ответа.
--
--   T = think_base_ms + (заморожено ? 0 : now() - think_since)
--
-- `think_since = null` означает «заморожено». Обе колонки лежат в `game`.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profile: по строке на каждого аутентифицированного пользователя,
-- зеркалит auth.users
-- ---------------------------------------------------------------------
create table public.profile (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text        not null,
    role         text        not null default 'player'
                             check (role in ('admin', 'player')),
    created_at   timestamptz not null default now()
);

comment on table public.profile is
    'Прикладные данные пользователя. Пароли живут в auth.users и здесь не появляются никогда.';

-- ---------------------------------------------------------------------
-- game: одна идущая викторина
-- ---------------------------------------------------------------------
create table public.game (
    id                  uuid primary key default gen_random_uuid(),
    title               text,
    status              text        not null default 'lobby'
                                    check (status in ('lobby', 'running', 'finished')),
    host_id             uuid        not null references public.profile (id),

    current_question_id uuid,       -- внешний ключ добавляется ниже, после `question`
    show_answer         boolean     not null default false,

    -- Ось времени размышления (см. шапку файла).
    think_base_ms       integer     not null default 0 check (think_base_ms >= 0),
    think_since         timestamptz,

    -- Сколько ожидания добавляет один принятый ответ, мс. Настройка на
    -- уровне игры, чтобы ведущий мог провести раунд быстрее или медленнее,
    -- не трогая код.
    penalty_step_ms     integer     not null default 5000 check (penalty_step_ms >= 0),

    created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- question: упорядоченный список, принадлежащий игре
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
-- question_answer: ответ, намеренно вынесенный из `question`
--
-- RLS работает построчно, а не поколоночно: всё, что игроку разрешено
-- прочитать, он читает целиком. Поэтому ответ, лежащий в одной строке с
-- вопросом, был бы виден каждому игроку через devtools ещё до того, как
-- ведущий его откроет, — ровно это и делала предыдущая версия, рассылая
-- a_text всем и всегда.
--
-- Вынесенный отдельно, ответ открывается политикой: см. 003_rls.sql.
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
-- participant: тот, кто играет в конкретной игре
--
-- profile_id обнуляемый намеренно: ведущий может добавить игрока без
-- аккаунта («ручного», как в старой версии) и вести ему счёт со своего
-- экрана.
-- ---------------------------------------------------------------------
create table public.participant (
    id               uuid    primary key default gen_random_uuid(),
    game_id          uuid    not null references public.game (id) on delete cascade,
    profile_id       uuid             references public.profile (id) on delete set null,
    display_name     text    not null,
    score            integer not null default 0,

    -- Личный дедлайн на оси T (мс). Игрок может жать буззер, когда T его прошло.
    penalty_until_ms integer not null default 0 check (penalty_until_ms >= 0),

    -- Имя файла джингла без расширения, разворачивается в audio/<sound_key>.mp3.
    -- null означает audio/default.mp3.
    sound_key        text,

    created_at       timestamptz not null default now(),

    unique (game_id, profile_id)
);

create index participant_game_idx on public.participant (game_id);

-- ---------------------------------------------------------------------
-- buzz: кто отвечает прямо сейчас
--
-- Не более одной строки на игру. Уникальный индекс — это и есть вся
-- история про гонку: все игроки делают INSERT, проходит ровно один,
-- проигравшие получают 23505. Никогда не решайте эту гонку на клиенте.
-- ---------------------------------------------------------------------
create table public.buzz (
    id             uuid        primary key default gen_random_uuid(),
    game_id        uuid        not null references public.game (id) on delete cascade,
    participant_id uuid        not null references public.participant (id) on delete cascade,
    created_at     timestamptz not null default now()
);

create unique index buzz_one_per_game on public.buzz (game_id);

-- ---------------------------------------------------------------------
-- answer_log: принятые ответы, журнал
--
-- Пишется, когда ведущий оценивает игрока. `delta` хранит то, что ведущий
-- поставил (-1 / 0 / +1), чтобы «отвечал, но не получил ничего» осталось
-- видно.
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
