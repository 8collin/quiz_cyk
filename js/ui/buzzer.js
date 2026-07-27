/**
 * The buzzer button: four states, one of which ticks.
 *
 *   answering   — "ОТВЕЧАЙТЕ", green, disabled
 *   taken       — "ИДЁТ ОТВЕТ...", grey, disabled
 *   cooldown    — "ПОДОЖДИТЕ N", amber, disabled, repaints ~5x/sec
 *   ready       — "ЕСТЬ ОТВЕТ!", red, enabled
 *
 * The countdown runs off Quiz.timing.remainingFor() and must not query the
 * database on a tick — one round with ten phones would be a few thousand
 * pointless requests. The cached axis is enough; realtime corrects it.
 *
 * TODO(skeleton): implement render() and the interval, and make sure the
 * interval is cleared when the cooldown ends or the player signs out.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.buzzer = {};
