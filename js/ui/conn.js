/**
 * Полоса «связь потеряна» и кнопка ручного обновления.
 *
 * Когда realtime теряет канал, игрок раньше видел немую «ОЖИДАНИЕ» без
 * единого намёка, что связь пропала, — и не знал, что делать. Теперь
 * сверху появляется полоса «Переподключаюсь…» с кнопкой «Обновить» на
 * случай, если автоматическое переподключение почему-то не справилось.
 *
 * Показывается с задержкой: короткий обрыв (моргнула сеть на секунду,
 * переезд между каналами) не должен мигать полосой на пустом месте. Прячет
 * её первое же восстановление связи.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.conn = {
    /** Сколько держим обрыв про себя, прежде чем показать полосу. */
    SHOW_DELAY_MS: 2000,

    showTimer: null,

    bind: function () {
        Quiz.dom.on('btn-reconnect', 'click', function () {
            // Полная перезагрузка состояния со свежей подпиской — самое
            // надёжное, что можно предложить, не перезагружая страницу.
            // loadGame при занятой загрузке вернёт undefined, поэтому
            // оборачиваем, чтобы не поймать ошибку на пустом месте.
            Promise.resolve(Quiz.main.loadGame()).catch(function () {});
        });
    },

    /** Реакция на смену состояния связи: true — есть, false — потеряна. */
    setConnected: function (connected) {
        if (connected) {
            this.hide();
            return;
        }
        // Уже показана или уже отсчитывается — второй раз не заводим.
        if (this.showTimer || !Quiz.dom.el('conn-banner').hidden) return;

        this.showTimer = setTimeout(function () {
            Quiz.ui.conn.showTimer = null;
            Quiz.dom.toggle('conn-banner', true);
        }, this.SHOW_DELAY_MS);
    },

    /** Убрать полосу и отменить отложенный показ. Зовётся и при выходе. */
    hide: function () {
        if (this.showTimer) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
        Quiz.dom.toggle('conn-banner', false);
    }
};
