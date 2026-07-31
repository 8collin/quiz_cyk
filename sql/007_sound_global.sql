-- ---------------------------------------------------------------------
-- Джингл — свойство человека, а не игры.
--
-- Применять после 006_users.sql.
--
-- До этого «кому какой джингл» лежало в `participant.sound_key`, а строка
-- participant — своя в каждой игре. Один человек в новой игре получал
-- пустой звук, и раздавать джинглы приходилось заново. С именем это уже
-- вылечено (этап 9): правда живёт в `profile`, а копию в `participant`
-- ведёт триггер. Здесь тот же приём для звука.
--
-- Почему не выкинуть `participant.sound_key` совсем, раз правда теперь в
-- профиле: джингл играет НА ВСЕХ устройствах, и каждое читает ключ у себя,
-- из строки participant, которую держит свежей realtime. `profile` в
-- публикацию realtime не входит (её незачем гонять на телефоны), поэтому
-- participant.sound_key остаётся — но теперь это ЗЕРКАЛО профиля, а не
-- отдельное значение. Горячий путь буззера (js/realtime.playJingleFor →
-- participant.sound_key) от этого не меняется вовсе.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Колонка-правда.
--
-- Обнуляемая: null означает «своего джингла нет», играет `default` — ровно
-- как раньше у participant. Внешнего ключа на `sound.key` нет намеренно, по
-- той же причине, что и у participant (см. 005_sounds.sql): удалённый звук
-- оставляет висячий ключ, и тот тихо проваливается в `default`. Для джингла
-- это правильный размен.
-- ---------------------------------------------------------------------
alter table public.profile add column if not exists sound_key text;

comment on column public.profile.sound_key is
    'Джингл человека, общий на все игры. Зеркалится в participant.sound_key триггером. null → default.';

-- ---------------------------------------------------------------------
-- Перенос уже розданных джинглов из participant в профиль.
--
-- Берём по одному ключу на человека. Расхождений между играми в данных нет
-- (у каждого один и тот же ключ во всех играх), но `distinct on ... order
-- by created_at desc` делает выбор однозначным и на случай, если они всё же
-- когда-то были: побеждает самая свежая строка.
--
-- Только ключи, которые в `sound` действительно есть: висячие (например,
-- участник с `sound_key='Чебурек old'`, звука с таким ключом уже нет)
-- переносить незачем — они и так звучат как `default`. Пусть профиль будет
-- честно пуст, чем понесёт мёртвую ссылку в каждую будущую игру.
-- ---------------------------------------------------------------------
update public.profile p
   set sound_key = sub.sound_key
  from (
      select distinct on (pt.profile_id)
             pt.profile_id,
             pt.sound_key
        from public.participant pt
       where pt.profile_id is not null
         and pt.sound_key is not null
         and exists (select 1 from public.sound s where s.key = pt.sound_key)
       order by pt.profile_id, pt.created_at desc
  ) sub
 where p.id = sub.profile_id
   and p.sound_key is distinct from sub.sound_key;

-- ---------------------------------------------------------------------
-- Сверка зеркала: participant должен совпасть с профилем прямо сейчас.
--
-- Триггер ниже подтянет копию при будущих правках, но существующие строки
-- он не тронет, а они обязаны сойтись с новой правдой с первого дня. Для
-- перенесённых это ничего не меняет (копировали же из них), а висячий ключ
-- («Чебурек old») здесь и обнуляется — звук от этого не меняется, он и был
-- `default`.
--
-- Ручных участников (profile_id is null) не касаемся: профиля у них нет,
-- джингла тоже, зеркалить нечего.
-- ---------------------------------------------------------------------
update public.participant pt
   set sound_key = p.sound_key
  from public.profile p
 where pt.profile_id = p.id
   and pt.sound_key is distinct from p.sound_key;

-- ---------------------------------------------------------------------
-- Триггер: правка профиля доезжает до копий в participant по всем играм.
--
-- Один в один с sync_participant_name (006_users.sql) и по тем же
-- причинам: копия нужна, потому что `participant` лежит в публикации
-- realtime, а `profile` — нет, и до телефонов правку довозит именно она.
-- Обновляются строки во ВСЕХ играх, включая доигранные: джингл принадлежит
-- человеку. WHERE обязателен и по делу (pg_safeupdate), и по смыслу — чужих
-- строк он не касается.
-- ---------------------------------------------------------------------
create or replace function public.sync_participant_sound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.participant
       set sound_key = new.sound_key
     where profile_id = new.id
       and sound_key is distinct from new.sound_key;
    return null;
end;
$$;

-- drop-if-exists, чтобы миграцию можно было применить повторно без ошибки:
-- у create trigger нет `if not exists`.
drop trigger if exists profile_sound_sync_after_update on public.profile;
create trigger profile_sound_sync_after_update
    after update of sound_key on public.profile
    for each row
    when (new.sound_key is distinct from old.sound_key)
    execute function public.sync_participant_sound();

-- ---------------------------------------------------------------------
-- Вход в игру теперь несёт и джингл.
--
-- Та же функция, что в 002_functions.sql, плюс `sound_key` из профиля.
-- Копируется он при КАЖДОМ входе (в том числе после F5 и переподключения):
-- если ведущий сменил человеку джингл, пока тот отсутствовал, повторный
-- вход обязан подхватить новый. Вместе с триггером выше это и держит
-- зеркало верным с обеих сторон — правка застаёт человека в игре или нет.
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
    v_sound          text;
begin
    if auth.uid() is null then
        raise exception 'нужен вход' using errcode = 'P0001';
    end if;

    if not exists (select 1 from public.game where id = p_game_id) then
        raise exception 'игра не найдена' using errcode = 'P0001';
    end if;

    select display_name, sound_key
      into v_name, v_sound
      from public.profile
     where id = auth.uid();

    insert into public.participant (game_id, profile_id, display_name, sound_key)
    values (p_game_id, auth.uid(), coalesce(v_name, 'Игрок'), v_sound)
    on conflict (game_id, profile_id) do update
       set display_name = excluded.display_name,
           sound_key    = excluded.sound_key
    returning id into v_participant_id;

    return v_participant_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Что в профиле менять нельзя — теперь ещё и джингл.
--
-- Та же функция, что в 006_users.sql (роль и логин), плюс `sound_key`.
-- Джинглы раздаёт ведущий из своей панели — это часть игры (смешной звук
-- сопернику), а не настройка игрока. Без этой строки политика
-- profile_update_self дала бы игроку переписать себе звук прямо из консоли,
-- и ведущий потерял бы над ним контроль. Через панель ведущий пишет как
-- админ (profile_admin_all) и проверку проходит.
--
-- Оговорка про auth.uid() = null прежняя и нужна тому же: миграция и SQL
-- Editor правят звук в обход этой защиты (перенос выше — как раз такой
-- случай).
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Сессии без auth.uid() — это не клиент: SQL Editor, миграция, service_role.
    if auth.uid() is null then
        return new;
    end if;

    if new.role is distinct from old.role and not public.is_admin() then
        raise exception 'менять роль запрещено' using errcode = 'P0001';
    end if;

    if new.login is distinct from old.login then
        raise exception 'менять логин запрещено' using errcode = 'P0001';
    end if;

    if new.sound_key is distinct from old.sound_key and not public.is_admin() then
        raise exception 'менять звук запрещено' using errcode = 'P0001';
    end if;

    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Права. Триггерную функцию не должен звать никто (см. 003_rls.sql):
-- Postgres проверяет EXECUTE в момент CREATE TRIGGER, а не при срабатывании.
-- ---------------------------------------------------------------------
revoke execute on function public.sync_participant_sound() from public, anon, authenticated;
