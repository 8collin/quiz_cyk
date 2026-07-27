/**
 * Единственный путь записи, доступный игроку.
 *
 * Гонку между игроками решает уникальный индекс `buzz_one_per_game`: все
 * делают INSERT, выживает ровно одна строка, остальные получают 23505.
 * Не пытайтесь выбрать победителя на клиенте — с разбросом часов и
 * задержек эту игру не выиграть.
 *
 * Коды ошибок, которые надо разбирать по имени:
 *   23505 — кто-то оказался быстрее; остаёмся заблокированными, realtime
 *           вот-вот покажет, кто именно
 *   P0001 — триггер отказал: кулдаун ещё идёт. Значит, наши часы или
 *           закешированная ось разъехались — синхронизироваться, а не
 *           повторять запрос
 */
Quiz.buzzer = {
    IDLE:  'idle',   // игры нет или я в ней не участвую
    READY: 'ready',
    MINE:  'mine',
    TAKEN: 'taken',
    WAIT:  'wait',

    /**
     * Нажатие ушло, ответа ещё нет.
     *
     * Существует ровно ради двойного тапа: между тапом и ответом сервера
     * проходит время, и на телефоне второе касание успевает уйти вторым
     * запросом. Строку в store кладёт realtime, поэтому до его прихода
     * состояние «я отвечаю» держится вот этим флагом, а не подделкой
     * store.buzz — одностороннее движение в store ломать нельзя.
     */
    pending: false,
    pendingSince: 0,

    /** Если ответ на INSERT потерялся, кнопка не должна остаться мёртвой. */
    PENDING_TIMEOUT_MS: 3000,

    /**
     * Текущее состояние кнопки. Заодно снимает `pending`, когда тот уже
     * не нужен, — иначе снимать его было бы неоткуда: успешный INSERT
     * узнаётся не по ответу, а по приезду строки через realtime.
     */
    state: function () {
        var mine = Quiz.store.myParticipant();
        if (!Quiz.store.game || !mine) return this.IDLE;

        if (this.pending) {
            if (Date.now() - this.pendingSince < this.PENDING_TIMEOUT_MS) {
                return this.MINE;
            }
            this.pending = false;
        }

        var buzz = Quiz.store.buzz;
        if (buzz) {
            this.pending = false;
            return buzz.participant_id === mine.id ? this.MINE : this.TAKEN;
        }
        if (Quiz.timing.remainingFor(mine) > 0) return this.WAIT;
        return this.READY;
    },

    hit: async function () {
        if (this.pending || this.state() !== this.READY) return;

        var game = Quiz.store.game;
        var mine = Quiz.store.myParticipant();

        // Гасим кнопку СИНХРОННО, до первого await. Всё, что после него,
        // случится уже в следующем такте, а тап к тому моменту повторят.
        this.pending = true;
        this.pendingSince = Date.now();
        Quiz.ui.buzzer.render();

        try {
            await Quiz.db.insertBuzz(game.id, mine.id);
            // Ничего не пишем в store: строку принесёт realtime.
        } catch (err) {
            this.pending = false;
            await this.handleError(err, game.id);
        }
        Quiz.ui.buzzer.render();
    },

    handleError: async function (err, gameId) {
        if (err.code === '23505') {
            // Опередили. Кнопка так и так заблокируется, когда realtime
            // принесёт чужую строку, — здесь делать нечего.
            console.log('Буззер: опередили');
            return;
        }

        if (err.code === 'P0001') {
            // База сказала, что кулдаун ещё идёт, а мы считали иначе.
            // Спорить нечем: авторитет у неё. Повтор запроса ничего не
            // изменит, поэтому пересобираем то, из чего мы считали, —
            // смещение часов, ось игры и свой личный дедлайн.
            console.warn('Буззер: кулдаун ещё идёт —', err.message);
            await Quiz.timing.syncClock();
            Quiz.store.game = await Quiz.db.getGame(gameId);
            Quiz.timing.applyGameRow(Quiz.store.game);
            Quiz.store.participants = await Quiz.db.getParticipants(gameId);
            return;
        }

        // Сеть или что-то незнакомое: кнопка вернётся в исходное, пусть жмут.
        console.error('Буззер: не удалось нажать —', err.code, err.message);
    }
};
