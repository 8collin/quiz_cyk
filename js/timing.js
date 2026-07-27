/**
 * Серверные часы и ось «времени размышления» T.
 *
 * Два правила, ради которых этот файл существует:
 *
 *  1. Не верить часам устройства. Телефоны врут на минуты, а каждый
 *     кулдаун — это сравнение с меткой времени, которую поставил Postgres.
 *     Смещение измеряется один раз, дальше поправка учитывается везде.
 *
 *  2. Кулдауны идут по оси T, а не по настенным часам. T движется, только
 *     пока никто не держит буззер, и замерзает, пока кто-то отвечает, —
 *     чтобы штраф не истёк тихо за время двухминутного ответа.
 *
 *         T = thinkBaseMs + (заморожено ? 0 : serverNow() - thinkSince)
 *
 *     Та же формула живёт в SQL как think_now(); они обязаны совпадать.
 *     Эта копия нужна, чтобы обратный отсчёт перерисовывался пять раз в
 *     секунду, не трогая сеть.
 */
Quiz.timing = {
    /** serverTime - localTime, мс. */
    offsetMs: 0,

    /** Накопленное T на момент последней заморозки. */
    thinkBaseMs: 0,

    /** Серверные мс, когда T возобновилось, или null, пока заморожено. */
    thinkSince: null,

    /** Цена одного принятого ответа, мс. Читается из строки game. */
    penaltyStepMs: 5000,

    /**
     * Измеряет смещение часов относительно базы.
     *
     * Круговая задержка достаточно симметрична, чтобы её середина была
     * лучшей дешёвой оценкой момента, когда сервер реально ответил.
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

    /** Лучшая оценка текущего серверного времени, мс. */
    serverNow: function () {
        return Date.now() + this.offsetMs;
    },

    /** Кеширует поля оси из строки game (первая загрузка или realtime). */
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

    /** Текущее положение на оси T, мс. Стоит на месте, пока thinkSince = null. */
    thinkNow: function () {
        if (this.thinkSince == null) {
            return this.thinkBaseMs;
        }
        return this.thinkBaseMs + (this.serverNow() - this.thinkSince);
    },

    /** Сколько участнику ещё ждать, мс. Никогда не отрицательное. */
    remainingFor: function (participant) {
        if (!participant) return 0;
        return Math.max(0, (participant.penalty_until_ms || 0) - this.thinkNow());
    }
};
