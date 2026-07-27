/**
 * Realtime subscriptions: the only thing that writes to Quiz.store during
 * a round.
 *
 * Hard-won lesson from the old version: after the host changes a question,
 * do not assume the buzz and participant channels will catch up on their
 * own. They are separate subscriptions and can lag behind the game row,
 * which left the "answering" highlight and the ⏳ badges stuck. Re-read
 * the affected tables explicitly after a question change.
 *
 * TODO(skeleton): implement
 *   subscribe(gameId) — postgres_changes on game / participant / buzz /
 *                       answer_log, plus a broadcast channel for the intro
 *   unsubscribe()
 *
 * On a buzz INSERT: play that participant's jingle. On any game UPDATE:
 * repaint the question and re-read the revealed answer.
 */
Quiz.realtime = {};
