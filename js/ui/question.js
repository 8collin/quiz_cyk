/**
 * The question area, and the status line in the header.
 *
 * The host always sees both the question and the answer (the answer in its
 * own panel below). A player sees the question, and the answer only after
 * the host reveals it — and by then the answer row is readable to them at
 * all, which RLS decides, not this file.
 *
 * TODO(skeleton): implement render() off Quiz.store, covering the empty
 * state ("ожидание загрузки вопросов") and "ВОПРОС 3 / 20".
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.question = {};
