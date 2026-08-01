-- ---------------------------------------------------------------------
-- Принятый ответ (+2) больше не начисляет кулдаун ответившему.
--
-- Применять после 008_lock_answered_question.sql.
--
-- Раньше answer_applies_effects (002_functions.sql) вешал штраф на ЛЮБУЮ
-- строку answer_log — в том числе на «+2 Ответ верный». Но «+2» и так
-- закрывает вопрос для всех (buzz_guard, P0001 question_answered, см. 008):
-- жать по этому вопросу нельзя уже никому, включая победителя. Кулдаун на
-- него поэтому ничего не сторожит, зато вешает ему на карточку ложный бейдж
-- ожидания с обратным отсчётом.
--
-- Теперь на delta = 2 меняем только счёт, а penalty_until_ms не трогаем.
-- Для −1/0/+1 поведение прежнее: вопрос остаётся открытым, и кулдаун держит
-- ответившего, пока остальные пробуют. delta = 2 — тот же «закрывающий»
-- балл, что проверяет замок в 008 (другого нет).
-- ---------------------------------------------------------------------

create or replace function public.answer_applies_effects()
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

    if new.delta = 2 then
        -- Принятый ответ закрывает вопрос для всех — штраф победителю не за
        -- что и не зачем (см. заголовок). Только счёт.
        update public.participant
           set score = score + new.delta
         where id = new.participant_id;
    else
        -- Открытый вопрос: счёт и шаг кулдауна от текущего T (как в 002).
        update public.participant
           set score            = score + new.delta,
               penalty_until_ms = public.think_now(new.game_id) + coalesce(v_step, 0)
         where id = new.participant_id;
    end if;

    return null;
end;
$$;
