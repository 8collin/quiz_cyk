/**
 * Server clock and the "thinking time" axis T.
 *
 * Two rules this file exists to enforce:
 *
 *  1. Never trust the device clock. Phones drift by minutes, and every
 *     cooldown is a comparison against a timestamp Postgres wrote. We
 *     measure the offset once and correct for it.
 *
 *  2. Cooldowns advance along T, not along wall-clock time. T moves only
 *     while nobody holds the buzzer and freezes while someone answers, so
 *     a penalty cannot quietly expire during a two-minute answer.
 *
 *         T = thinkBaseMs + (frozen ? 0 : serverNow() - thinkSince)
 *
 *     The same formula lives in SQL as think_now(); the two must agree.
 *     This copy exists so the countdown can repaint 5x a second without
 *     touching the network.
 */
Quiz.timing = {
    /** serverTime - localTime, in ms. */
    offsetMs: 0,

    /** Accumulated T at the moment of the last freeze. */
    thinkBaseMs: 0,

    /** Server ms when T resumed, or null while frozen. */
    thinkSince: null,

    /** Cost of one accepted answer, ms. Read from the game row. */
    penaltyStepMs: 5000,

    /**
     * Measures the clock offset against the database.
     *
     * The round trip is symmetric enough that its midpoint is the best
     * cheap estimate of when the server actually answered.
     */
    syncClock: async function () {
        var t0 = Date.now();
        var result = await Quiz.db.client.rpc('server_now');
        var t1 = Date.now();

        if (result.error) {
            console.warn('Не удалось синхронизировать часы:', result.error.message);
            return;
        }

        var serverMs = Date.parse(result.data);
        if (!isNaN(serverMs)) {
            this.offsetMs = serverMs - (t0 + (t1 - t0) / 2);
        }
    },

    /** Best estimate of the current server time, ms. */
    serverNow: function () {
        return Date.now() + this.offsetMs;
    },

    /** Caches the axis fields off a game row (initial load or realtime). */
    applyGameRow: function (game) {
        if (!game) return;
        if ('think_base_ms' in game) {
            this.thinkBaseMs = Number(game.think_base_ms) || 0;
        }
        if ('think_since' in game) {
            this.thinkSince = game.think_since ? Date.parse(game.think_since) : null;
        }
        if ('penalty_step_ms' in game) {
            this.penaltyStepMs = Number(game.penalty_step_ms) || 0;
        }
    },

    /** Current position on the T axis, ms. Frozen when thinkSince is null. */
    thinkNow: function () {
        if (this.thinkSince == null) {
            return this.thinkBaseMs;
        }
        return this.thinkBaseMs + (this.serverNow() - this.thinkSince);
    },

    /** How much longer a participant must wait, ms. Never negative. */
    remainingFor: function (participant) {
        if (!participant) return 0;
        return Math.max(0, (participant.penalty_until_ms || 0) - this.thinkNow());
    }
};
