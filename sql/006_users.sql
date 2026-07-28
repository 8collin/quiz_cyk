-- ---------------------------------------------------------------------
-- Пользователи: логин отдельно от имени, смена пароля и удаление.
--
-- Применять после 005_sounds.sql.
--
-- До этого имя игрока работало сразу двумя вещами. Адрес для Supabase
-- Auth считался из него (`Quiz.auth.loginFor`), поэтому переименовать
-- человека значило отобрать у него вход: в `auth.users` остался бы
-- прежний адрес, а по новому имени он не нашёлся бы никогда. Интерфейса
-- переименования не было, так что налететь на это было негде — панель
-- пользователей делает его штатным действием, и развязать эти две роли
-- надо до неё, а не после.
--
-- Развязка вот такая:
--
--   profile.login        адрес, которым человек входит. Неизменен.
--   profile.display_name имя, которое видно. Меняется свободно.
--
-- Адрес при этом остаётся там же, где и был, — в `auth.users.email`;
-- здесь только его зеркало. Зеркало нужно потому, что роли
-- `authenticated` читать `auth.users` не разрешено, а вывести адрес из
-- имени нельзя даже до всякого переименования: у аккаунта «Ведущий»
-- адрес `host@quiz.local`, никакой транслитерацией он не получается.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Логин
--
-- Обнуляемый намеренно. Заполняет колонку триггер handle_new_user из
-- `new.email`, а адрес есть не у всякого пользователя Supabase: вход без
-- пароля (`signInAnonymously`, отложенный вариант из TODO.md) заводит
-- строку с пустой почтой, и `not null` тогда ломал бы саму регистрацию.
-- Панель показывает то, что есть.
-- ---------------------------------------------------------------------
alter table public.profile add column if not exists login text;

comment on column public.profile.login is
    'Зеркало auth.users.email — то, чем человек входит. Меняться не должно: guard_profile_role.';

update public.profile p
   set login = u.email
  from auth.users u
 where u.id = p.id
   and p.login is distinct from u.email;

alter table public.profile
    add constraint profile_login_unique unique (login);

-- ---------------------------------------------------------------------
-- Профиль при регистрации — то же, что и было, плюс логин.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profile (id, display_name, role, login)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', 'Игрок'),
        'player',
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Что в профиле менять нельзя.
--
-- Было про роль, стало ещё и про логин, и по той же причине: в WITH CHECK
-- политики нельзя сравнить со старым значением строки, а сравнивать надо
-- именно с ним. Логин заморожен для всех, включая ведущего: он обязан
-- сходиться с `auth.users.email`, а туда панель не пишет — вход менять
-- она не умеет.
--
-- Оговорка про auth.uid() остаётся прежней и нужна ровно для этого файла:
-- миграция и SQL Editor работают без пользователя, и заполнение колонки
-- выше не должно упереться в собственную защиту.
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Сессии без auth.uid() — это не клиент: SQL Editor, миграция, service_role.
    -- Через PostgREST сюда не пройти: все политики на profile выданы роли
    -- authenticated, у которой auth.uid() всегда есть, а anon отсекает RLS
    -- ещё до триггера. Без этой оговорки первого админа назначить нельзя
    -- вообще никак — админов нет, значит и права выдать роль нет ни у кого.
    if auth.uid() is null then
        return new;
    end if;

    if new.role is distinct from old.role and not public.is_admin() then
        raise exception 'менять роль запрещено' using errcode = 'P0001';
    end if;

    if new.login is distinct from old.login then
        raise exception 'менять логин запрещено' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Имя человека — одно на все игры.
--
-- `participant.display_name` остаётся копией, но ведёт её теперь база, а
-- не тот, кто переименовывает. Копия нужна по трём причинам, и все три
-- переживут любой интерфейс:
--
--   * строка participant переживает удаление аккаунта (profile_id
--     обнуляется, см. 001_schema.sql), и статистика прошлых игр не должна
--     терять имя вместе с ним;
--   * `participant` лежит в публикации realtime, а `profile` — нет, так
--     что до телефонов доезжает правка именно копии;
--   * ведущий может завести игрока без аккаунта — у того профиля нет
--     вовсе, а имя есть.
--
-- Обновляются строки во ВСЕХ играх, включая доигранные: имя принадлежит
-- человеку, а не игре. Условие в WHERE обязательно и по делу
-- (pg_safeupdate), и по смыслу — чужих строк оно не касается.
-- ---------------------------------------------------------------------
create or replace function public.sync_participant_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.participant
       set display_name = new.display_name
     where profile_id = new.id
       and display_name is distinct from new.display_name;
    return null;
end;
$$;

create trigger profile_name_sync_after_update
    after update of display_name on public.profile
    for each row
    when (new.display_name is distinct from old.display_name)
    execute function public.sync_participant_name();

-- ---------------------------------------------------------------------
-- Пароль игроку.
--
-- Единственный способ, оставшийся клиенту: `auth.updateUser` меняет
-- пароль только себе, а `auth.admin.*` требует ключ service_role, которому
-- в этом репозитории быть нельзя. Значит — функция, пишущая в auth.users
-- напрямую, и надо понимать, чем за это плачено:
--
--   * это не поддерживаемый Supabase путь. Схема GoTrue может поехать, и
--     тогда сломается вот эта функция, а не вход;
--   * пароль уходит параметром RPC открытым текстом. TLS его закрывает,
--     но в логах он оказаться может. До этой функции пароль в проекте не
--     покидал двух окошек prompt;
--   * старые сессии остаются жить. Смена пароля не выкидывает того, кто
--     уже вошёл, — токен в localStorage работает до истечения. Это
--     сознательно: ведущий меняет пароль забывшему его игроку, а не
--     отбирает доступ, и выкидывать при этом кого-то из середины раунда
--     не за что. Понадобится обратное — чистить auth.refresh_tokens.
--
-- Хеш — тот же bcrypt, что делает GoTrue. `gen_salt('bf', 10)` со
-- сложностью указан явно: по умолчанию pgcrypto даёт 6. Схема extensions
-- в вызове тоже явно — search_path у функции стоит в public, а pgcrypto
-- в этом проекте живёт в extensions.
--
-- security definer обходит RLS, поэтому is_admin() в теле обязателен.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'admin only' using errcode = 'P0001';
    end if;

    -- Своя граница, и она НЕ совпадает с той, что у GoTrue: мимо него мы
    -- и идём, так что длину задаём здесь. Два знака — по решению
    -- ведущего: пароль диктуют через комнату вслух, и требование к нему
    -- ровно одно — чтобы он был. Ноль знаков всё же отвергаем: пустое
    -- поле — это не короткий пароль, это ошибка ввода.
    if length(coalesce(p_password, '')) < 2 then
        raise exception 'пароль короче двух знаков' using errcode = 'P0001';
    end if;

    if not exists (select 1 from public.profile where id = p_user_id) then
        raise exception 'пользователь не найден' using errcode = 'P0001';
    end if;

    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
           updated_at         = now()
     where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Удаление аккаунта.
--
-- Каскадом уходит profile, а `participant.profile_id` обнуляется
-- (`on delete set null`) — строка со счётом, именем и журналом остаётся.
-- Это выбрано нарочно: удалять человека из уже сыгранной статистики
-- значит менять её результат задним числом.
--
-- Проверка ровно одна: себя удалить нельзя. Случай «удалили последнего
-- админа» ею и закрыт — последний админ может быть только тем, кто
-- запрос и прислал, а его-то функция и не пропустит.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'admin only' using errcode = 'P0001';
    end if;

    if p_user_id = auth.uid() then
        raise exception 'себя удалить нельзя' using errcode = 'P0001';
    end if;

    delete from auth.users where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Права на выполнение
--
-- Причины те же, что в 003_rls.sql: Postgres раздаёт EXECUTE роли PUBLIC,
-- а PostgREST выставляет наружу всё, до чего дотягивается anon. Поэтому
-- сначала отзываем, потом раздаём поимённо. Триггерную функцию не должен
-- звать никто.
-- ---------------------------------------------------------------------
revoke execute on function public.sync_participant_name() from public, anon, authenticated;

revoke execute on function public.admin_set_password(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_delete_user(uuid)        from public, anon, authenticated;

grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_user(uuid)        to authenticated;
