/**
 * Действия ведущего. Игроку отсюда недоступно ничего: интерфейс прячет
 * элементы управления, а RLS-политики всё равно отвергнут запись.
 *
 * TODO(скелет): реализовать
 *   goToQuestion(position)   — сдвинуть указатель, затем reset_thinking()
 *   next() / prev()
 *   toggleAnswer()           — переключить game.show_answer; именно это
 *                              открывает игрокам чтение question_answer
 *   score(participantId, d)  — записать answer_log (штраф наложит триггер)
 *                              и освободить слот буззера
 *   releaseBuzz()            — снять отвечающего без оценки; намеренно НЕ
 *                              считается попыткой и не двигает кулдауны
 *   reducePenalty(id)        — rpc, отмена одного случайного нажатия
 *   clearPenalties()         — rpc reset_thinking
 *   addOfflinePlayer(name)   — строка participant с profile_id = null
 *   removeParticipant(id)
 *   restart()                — счёт в ноль, вопросы стереть, ось сбросить
 *   playIntro()              — локально + broadcast в канал игры
 */
Quiz.game = {};
