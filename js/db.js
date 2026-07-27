/**
 * Supabase client plus every query the app makes.
 *
 * All table and column names live in this one file. Nothing above it
 * should mention `.from('participant')` or a column string — if the schema
 * moves, only this file follows.
 */
Quiz.db = {
    client: null,

    init: function () {
        var cfg = Quiz.config;
        if (cfg.SUPABASE_URL.indexOf('PASTE_') === 0) {
            throw new Error(
                'Supabase не настроен: впишите URL и anon key в js/config.js'
            );
        }
        this.client = window.supabase.createClient(
            cfg.SUPABASE_URL,
            cfg.SUPABASE_ANON_KEY
        );
        return this.client;
    },

    /**
     * Unwraps the { data, error } envelope so callers can just await a
     * value. Errors are thrown with the Postgres code preserved on
     * `err.code`, which the buzzer relies on to tell 23505 (someone beat
     * me to it) from P0001 (still on cooldown).
     */
    unwrap: function (result) {
        if (result.error) {
            var err = new Error(result.error.message);
            err.code = result.error.code;
            err.details = result.error.details;
            throw err;
        }
        return result.data;
    }

    // --- Queries are added here as each feature lands. Planned shape:
    //
    //   getGame(gameId)              -> game row
    //   getQuestions(gameId)         -> ordered question rows
    //   getParticipants(gameId)      -> participant rows
    //   getCurrentBuzz(gameId)       -> buzz row or null
    //   getAnswerLog(questionId)     -> answer_log rows for the badge
    //   getRevealedAnswer(questionId)-> question_answer row; RLS returns
    //                                   nothing until the host reveals it
    //   replaceQuestions(gameId, qs) -> wipes and re-inserts from Excel
    //   setCurrentQuestion(...)      -> host navigation
    //   insertBuzz(gameId, partId)   -> the atomic grab, see js/buzzer.js
};
