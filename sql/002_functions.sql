-- =====================================================================
-- Викторина — серверные функции и триггеры.
--
-- Здесь живёт всё, что нельзя доверять клиенту: авторитетные часы, ось
-- времени размышления и проверка того, что игроку вообще можно жать.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Хелперы про личность пользователя.
--
-- security definer, чтобы читать `profile` / `participant` в обход их
-- собственных RLS-политик, — иначе получилась бы рекурсия. Используются
-- и политиками из 003_rls.sql, и защитами в этом файле.
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
-- Авторитетные часы.
--
-- Клиент вызывает это один раз при старте и запоминает смещение. Часы
-- телефона врут на минуты, а каждый кулдаун сравнивается с серверным
-- временем.
-- ---------------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = public
as $$
    select now();
$$;

-- ---------------------------------------------------------------------
-- Текущее значение оси T для игры, в мс.
-- Повторяет клиентскую формулу из js/timing.js — держите их согласованными.
-- ---------------------------------------------------------------------
create or replace function public.think_now(p_game_id uuid)
returns bigint
language sql
stable
set search_path = public
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
-- Заморозка / возобновление оси.
--
-- Заморозка сворачивает прошедшее время в think_base_ms и обнуляет
-- think_since. Возобновление ставит think_since = now(). Обе идемпотентны,
-- поэтому триггеры ниже вызывают их, не проверяя текущее состояние.
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
-- Сброс оси и всех личных кулдаунов. Вызывается, когда ведущий переходит
-- к другому вопросу или перезапускает игру.
--
-- Обратите внимание на WHERE: Supabase работает с pg_safeupdate, который
-- отвергает UPDATE/DELETE без него. Предыдущая версия спотыкалась ровно
-- об это, и сброс пришлось унести на клиент.
-- ---------------------------------------------------------------------
create or replace function public.reset_thinking(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- security definer обходит RLS, поэтому проверка роли обязана быть здесь.
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
-- Отмена одного случайного нажатия: снять один шаг штрафа и освободить
-- слот отвечающего, если игрок его занимает.
--
-- Важны обе половины. Снять только штраф — игрок залипнет в статусе
-- «отвечает»; снять только слот — останется ждать штраф, которого не
-- заслужил.
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
    -- security definer обходит RLS, поэтому проверка роли обязана быть здесь.
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
-- Триггер: нажать можно, только когда личный кулдаун истёк по оси T.
--
-- Клиент и так гасит кнопку, но это косметика — вот проверка, которая
-- держит, когда у кого-то врут часы или кто-то полез в API напрямую.
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
        raise exception 'penalty_active: осталось % мс', (v_until - v_now)
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
-- Триггер: ось замерзает, пока кто-то отвечает, и возобновляется, когда
-- слот освобождён, — чтобы кулдауны тикали только в открытой игре.
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
-- Триггер: принятый ответ стоит игроку одного шага штрафа, отсчитанного
-- от текущего положения оси.
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
-- Вход игрока в игру.
--
-- Строка `participant` не может появиться от самого игрока напрямую:
-- писать в эту таблицу разрешено только ведущему (см. 003_rls.sql), иначе
-- игрок правил бы себе счёт. Поэтому вход идёт через эту функцию —
-- она создаёт строку от имени владельца, но заполняет profile_id
-- исключительно из auth.uid(), так что записаться за другого нельзя.
--
-- Идемпотентна: повторный вызов возвращает уже существующую строку. Это и
-- есть нормальный путь после перезагрузки страницы.
--
-- Ведущий по-прежнему может добавить «ручного» игрока без аккаунта —
-- у того profile_id остаётся null, и под ограничение unique он не попадает,
-- потому что в Postgres NULL не конфликтует с NULL.
-- ---------------------------------------------------------------------
create or replace function public.join_game(p_game_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_participant_id uuid;
    v_name           text;
begin
    if auth.uid() is null then
        raise exception 'нужен вход' using errcode = 'P0001';
    end if;

    if not exists (select 1 from public.game where id = p_game_id) then
        raise exception 'игра не найдена' using errcode = 'P0001';
    end if;

    select display_name into v_name
      from public.profile
     where id = auth.uid();

    insert into public.participant (game_id, profile_id, display_name)
    values (p_game_id, auth.uid(), coalesce(v_name, 'Игрок'))
    on conflict (game_id, profile_id) do update
       set display_name = excluded.display_name
    returning id into v_participant_id;

    return v_participant_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Триггер: заводим строку profile при регистрации, чтобы приложение
-- никогда не сталкивалось с аутентифицированным пользователем без профиля.
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
