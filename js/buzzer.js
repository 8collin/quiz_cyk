/**
 * The player's single write path.
 *
 * The race between players is settled by the unique index
 * `buzz_one_per_game`: everyone INSERTs, exactly one row survives, the
 * losers come back with 23505. Never try to decide the winner on the
 * client — clocks and latency make that unwinnable.
 *
 * Error codes worth handling by name:
 *   23505 — someone was faster; stay disabled, realtime will show who
 *   P0001 — the trigger refused: still on cooldown. Means our clock or
 *           cached axis drifted, so resync rather than retry.
 *
 * TODO(skeleton): implement
 *   hit()  — local guards (nobody answering, no cooldown), disable the
 *            button immediately against a double tap, insert, classify
 *            the error
 */
Quiz.buzzer = {};
