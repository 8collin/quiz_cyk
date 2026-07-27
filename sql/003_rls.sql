-- =====================================================================
-- Викторина — row level security.
--
-- Anon-ключ публичный: он лежит внутри страницы, и прочитать его может
-- кто угодно. Значит, всё, что действительно важно, должно держаться
-- здесь, в базе. В предыдущей версии этого не было вовсе — любой игрок
-- мог поставить себе счёт двумя строчками в консоли.
--
-- Базовое правило: игроки читают, ведущий пишет. Единственное, что
-- игроку разрешено записать, — строка buzz от своего имени.
-- =====================================================================

alter table public.profile         enable row level security;
alter table public.game            enable row level security;
alter table public.question        enable row level security;
alter table public.question_answer enable row level security;
alter table public.participant     enable row level security;
alter table public.buzz            enable row level security;
alter table public.answer_log      enable row level security;

-- Хелперы is_admin() / my_participant_id() определены в 002_functions.sql,
-- потому что тамошние функции тоже защищают себя через is_admin().

-- ---------------------------------------------------------------------
-- profile
--
-- Любой вошедший видит имена всех — это нужно табло. Переименовать себя
-- можно, повысить себя нельзя: `role` стережёт триггер ниже, потому что
-- в WITH CHECK нельзя сравнить со старым значением строки.
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
        raise exception 'менять роль запрещено' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

create trigger guard_profile_role_before_update
    before update on public.profile
    for each row
    execute function public.guard_profile_role();

-- ---------------------------------------------------------------------
-- game / question: читают все игроки, пишет только ведущий
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
-- question_answer: показ ответа, обеспеченный базой
--
-- Игрок может прочитать ответ, только пока это текущий вопрос И ведущий
-- нажал «Ответ». До этого момента строки для его сессии просто не
-- существует — никакое ковыряние в консоли её не достанет.
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
-- participant: счёт читают все, меняет только ведущий
-- ---------------------------------------------------------------------
create policy participant_select_authenticated on public.participant
    for select to authenticated
    using (true);

create policy participant_admin_all on public.participant
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- buzz: единственное, что пишет игрок
--
-- INSERT разрешён только от имени своей же строки participant. Удаление —
-- дело ведущего: игрок не должен уметь освободить слот за другого или
-- стереть собственное нажатие, чтобы увернуться от штрафа.
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
-- answer_log: пишет ведущий при оценке, читают все
-- ---------------------------------------------------------------------
create policy answer_log_select_authenticated on public.answer_log
    for select to authenticated
    using (true);

create policy answer_log_admin_all on public.answer_log
    for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Права на выполнение функций
--
-- freeze/resume отзываем у всех: их дело — вызываться из триггеров, а не
-- руками из клиента. Остальные проверяют роль внутри себя.
-- ---------------------------------------------------------------------
revoke execute on function public.freeze_thinking(uuid) from public, anon, authenticated;
revoke execute on function public.resume_thinking(uuid) from public, anon, authenticated;

grant execute on function public.server_now()         to authenticated;
grant execute on function public.think_now(uuid)      to authenticated;
grant execute on function public.reset_thinking(uuid) to authenticated;
grant execute on function public.reduce_penalty(uuid) to authenticated;

-- Единственная функция, которую вызывает игрок, а не ведущий: она пишет
-- строку participant за него, потому что напрямую в эту таблицу писать
-- разрешено только ведущему. profile_id внутри берётся из auth.uid(),
-- подставить чужой нельзя.
grant execute on function public.join_game(uuid)      to authenticated;
