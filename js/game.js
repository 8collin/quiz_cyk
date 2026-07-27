/**
 * Host actions. Nothing here is reachable for a player: the UI hides the
 * controls and the RLS policies reject the writes anyway.
 *
 * TODO(skeleton): implement
 *   goToQuestion(position)   — move the pointer, then reset_thinking()
 *   next() / prev()
 *   toggleAnswer()           — flip game.show_answer; this is what makes
 *                              question_answer readable to players
 *   score(participantId, d)  — write answer_log (the trigger applies the
 *                              penalty) and release the buzz slot
 *   releaseBuzz()            — drop the answering player without scoring;
 *                              deliberately does NOT count as an attempt
 *   reducePenalty(id)        — rpc, undoes one accidental buzz
 *   clearPenalties()         — rpc reset_thinking
 *   addOfflinePlayer(name)   — participant row with profile_id = null
 *   removeParticipant(id)
 *   restart()                — scores to 0, questions dropped, axis reset
 *   playIntro()              — local + broadcast on the game channel
 */
Quiz.game = {};
