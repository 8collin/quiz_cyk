/**
 * Точка входа. Подключается последней, связывает всё вместе и запускает
 * приложение.
 *
 * Сделано на этапе 1: вход, восстановление сессии, выход, роль на <body>,
 * громкость. Загрузка игры здесь пока сведена к строке `game` — вопросы,
 * участники, буззер и realtime приедут на этапе 2.
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

            var game = await Quiz.db.getActiveGame();
            Quiz.store.game = game;
            Quiz.timing.applyGameRow(game);

            if (!game) {
                console.log('Игр со статусом running нет — показывать нечего.');
                return;
            }
            // Ведущий в списке участников не появляется: он не играет.
            if (!Quiz.store.isAdmin()) {
                await Quiz.db.joinGame(game.id);
            }
        } catch (err) {
            // Вход при этом состоялся, поэтому обратно на форму не выкидываем.
            console.error('Не удалось загрузить игру:', err.message);
        }
    },

    showLogin: function () {
        Quiz.dom.setRole('unknown');
        Quiz.ui.login.show();
    },

    signOut: async function () {
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
