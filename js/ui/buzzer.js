/**
 * Кнопка буззера: пять состояний, одно из которых тикает.
 *
 *   ничего не знаем — «ОЖИДАНИЕ», серая, заблокирована
 *   отвечаю я    — «ОТВЕЧАЙТЕ», зелёная, заблокирована
 *   занято       — «ИДЁТ ОТВЕТ...», серая, заблокирована
 *   кулдаун      — «ПОДОЖДИТЕ N», янтарная, заблокирована,
 *                  перерисовывается около пяти раз в секунду
 *   свободна     — «ЕСТЬ ОТВЕТ!», красная, доступна
 *
 * Доступной кнопка становится в одном-единственном случае: когда игра и
 * своя строка участника уже прочитаны и кулдаун по ним не идёт. Всё
 * остальное — «ОЖИДАНИЕ»: игры нет, меня в ней нет, ИЛИ загрузка ещё
 * идёт и ответить на вопрос про кулдаун пока нечем. Разрешать нажатие,
 * пока ответ неизвестен, нельзя — телефон после F5 секунду показывал бы
 * красную «ЕСТЬ ОТВЕТ!» игроку, который на самом деле ждёт штраф.
 * Поэтому main.js рисует кнопку один раз ещё до загрузки, на пустом
 * store, и первое, что видит игрок, — заблокированное «ОЖИДАНИЕ».
 *
 * Обратный отсчёт считается от Quiz.timing.remainingFor() и НЕ должен
 * ходить в базу на каждый тик — один раунд с десятью телефонами это
 * несколько тысяч бессмысленных запросов. Закешированной оси достаточно,
 * realtime её поправит.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.buzzer = {
    timer: null,

    /** text === null означает «подпись считается на лету». */
    STATES: {
        // Он же «ещё не загрузились»: см. про доступность в шапке файла.
        idle:  { text: 'ОЖИДАНИЕ',      css: 'is-taken', disabled: true },
        mine:  { text: 'ОТВЕЧАЙТЕ',     css: 'is-mine',  disabled: true },
        taken: { text: 'ИДЁТ ОТВЕТ...', css: 'is-taken', disabled: true },
        wait:  { text: null,            css: 'is-wait',  disabled: true },
        ready: { text: 'ЕСТЬ ОТВЕТ!',   css: '',         disabled: false }
    },

    bind: function () {
        Quiz.dom.on('btn-buzzer', 'click', function () { Quiz.buzzer.hit(); });
    },

    render: function () {
        var button = Quiz.dom.el('btn-buzzer');
        var state = Quiz.buzzer.state();
        var spec = this.STATES[state];

        button.className = 'btn-buzzer' + (spec.css ? ' ' + spec.css : '');
        button.disabled = spec.disabled;
        button.textContent = spec.text === null ? this.waitLabel() : spec.text;

        // Интервал нужен ровно в одном состоянии. Кулдаун истечёт — render
        // придёт из самого интервала, состояние станет другим, и таймер
        // погасит сам себя.
        if (state === Quiz.buzzer.WAIT) {
            this.startTicking();
        } else {
            this.stopTicking();
        }
    },

    /** «ПОДОЖДИТЕ 4.2» — десятые, чтобы было видно, что счётчик живой. */
    waitLabel: function () {
        var left = Quiz.timing.remainingFor(Quiz.store.myParticipant());
        return 'ПОДОЖДИТЕ ' + (Math.ceil(left / 100) / 10).toFixed(1);
    },

    startTicking: function () {
        if (this.timer) return;
        var self = this;
        this.timer = setInterval(function () {
            self.render();
        }, Quiz.config.COUNTDOWN_TICK_MS);
    },

    stopTicking: function () {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }
};
