-- ---------------------------------------------------------------------
-- Засчитанный ответ закрывает вопрос для буззера.
--
-- Применять после 007_sound_global.sql.
--
-- Как только ведущий засчитывает ответ кнопкой «+2» (в players.js она так и
-- задумана — «этим вопрос и заканчивается»), жать буззер больше нельзя
-- никому, включая того, кому «+2» и поставили, — до тех пор пока ведущий не
-- перейдёт на другой, ещё не отвеченный вопрос.
--
-- «Отвеченность» — свойство ВОПРОСА, а не игры и не момента: это строка
-- answer_log с delta = 2. Поэтому переход на неотвеченный вопрос снимает
-- замок сам (у нового вопроса такой строки нет), а возврат на уже
-- отвеченный — оставляет (строка никуда не делась). Отдельного флага в схеме
-- заводить не понадобилось.
--
-- Правило держит база, а не только погашенная кнопка на клиенте: буззер —
-- единственная запись, доступная игроку, и игрок с открытой консолью иначе
-- вставил бы строку buzz в обход интерфейса. Тот же довод, по которому здесь
-- же живёт проверка кулдауна.
-- ---------------------------------------------------------------------

create or replace function public.buzz_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_until     integer;
    v_now       bigint;
    v_current_q uuid;
begin
    -- Замок на отвеченном вопросе проверяем ПЕРВЫМ: он сильнее кулдауна и
    -- глобальнее — не про одного игрока, а про весь стол. delta = 2 — это
    -- «+2 Ответ верный» из js/ui/players.js; другого «закрывающего» балла
    -- нет (−1/0/+1 вопрос не закрывают).
    select current_question_id into v_current_q
      from public.game
     where id = new.game_id;

    if v_current_q is not null and exists (
        select 1
          from public.answer_log
         where question_id = v_current_q
           and delta = 2
    ) then
        raise exception 'question_answered' using errcode = 'P0001';
    end if;

    -- Дальше — прежняя проверка: нажать можно, только когда личный кулдаун
    -- истёк по оси T (см. 002_functions.sql).
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
