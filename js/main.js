/**
 * Точка входа. Подключается последней, связывает всё вместе и запускает
 * приложение.
 *
 * Сделано на этапе 1: вход, восстановление сессии, выход, роль на <body>,
 * громкость. На этапе 2: первичная загрузка состояния, подписки realtime
 * и отрисовка. Буззер и панель ведущего — этапы 3 и 4.
 */
Quiz.main = {
    start: async function () {
        try {
            Quiz.db.init();
        } catch (err) {
            // Единственная ошибка, после которой продолжать нечем.
            Quiz.ui.login.setError(err.message);
            console.error(err);
            return;
        }

        this.bindVolume();
        Quiz.ui.buzzer.bind();
        Quiz.dom.on('btn-logout', 'click', function () { Quiz.main.signOut(); });
        Quiz.ui.login.bind(function (profile) { Quiz.main.enterGame(profile); });

        // Токен может истечь или сессию закроют из другой вкладки.
        Quiz.auth.onSignedOut(function () { Quiz.main.showLogin(); });

        var profile = null;
        try {
            profile = await Quiz.auth.restoreSession();
        } catch (err) {
            // Сессия есть, но профиль не прочитался — вести себя как гость.
            console.warn('Сессию восстановить не удалось:', err.reason, err.message);
        }

        if (profile) {
            await this.enterGame(profile);
        } else {
            this.showLogin();
        }
    },

    /**
     * Одно и то же для входа по паролю и для восстановленной сессии, чтобы
     * два пути не разъехались.
     */
    enterGame: async function (profile) {
        Quiz.dom.setRole(profile.role === 'admin' ? 'admin' : 'player');
        Quiz.ui.login.hide();

        try {
            // Часы — раньше всего, что покажет время. Иначе первая отрисовка
            // обратного отсчёта уйдёт по часам телефона, а они врут.
            await Quiz.timing.syncClock();
            await this.loadGame();
        } catch (err) {
            // Вход при этом состоялся, поэтому обратно на форму не выкидываем.
            console.error('Не удалось загрузить игру:', err.message);
        }
    },

    /**
     * Первичная загрузка состояния и подписка на изменения.
     *
     * Всё, что живёт не дольше текущего вопроса, читает
     * realtime.reloadQuestionScoped() — та же функция, которой потом
     * пользуются обработчики при смене вопроса. Один путь вместо двух:
     * иначе первая загрузка и обновление по ходу игры разъедутся, а
     * расходятся такие пары всегда молча.
     */
    loadGame: async function () {
        var game = await Quiz.db.getActiveGame();
        Quiz.store.game = game;
        Quiz.timing.applyGameRow(game);

        if (!game) {
            console.log('Игр со статусом running нет — показывать нечего.');
            this.render();
            return;
        }

        // Ведущий в списке участников не появляется: он не играет.
        // Строку заводим до чтения участников, иначе игрок не увидит себя.
        if (!Quiz.store.isAdmin()) {
            await Quiz.db.joinGame(game.id);
        }

        Quiz.store.questions = await Quiz.db.getQuestions(game.id);
        await Quiz.realtime.reloadQuestionScoped();

        Quiz.realtime.onChange = function () { Quiz.main.render(); };
        Quiz.realtime.subscribe(game.id);

        this.render();
    },

    render: function () {
        Quiz.ui.question.render();
        Quiz.ui.players.render();
        Quiz.ui.buzzer.render();
    },

    showLogin: function () {
        Quiz.realtime.unsubscribe();
        // Иначе интервал отсчёта переживёт выход и продолжит тикать.
        Quiz.ui.buzzer.stopTicking();
        Quiz.dom.setRole('unknown');
        Quiz.ui.login.show();
    },

    signOut: async function () {
        Quiz.realtime.unsubscribe();
        try {
            await Quiz.auth.signOut();
        } catch (err) {
            console.warn('Выход с ошибкой:', err.message);
        }
        // Показываем форму в любом случае: локальную сессию SDK уже стёр.
        this.showLogin();
    },

    bindVolume: function () {
        var slider = Quiz.dom.el('volume-slider');
        slider.value = String(Math.round(Quiz.audio.load() * 100));
        slider.addEventListener('input', function () {
            Quiz.audio.setVolume(slider.value);
        });
    }
};

window.addEventListener('DOMContentLoaded', function () {
    console.log('Quiz', Quiz.VERSION);
    Quiz.main.start();
});
