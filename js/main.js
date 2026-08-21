/**
 * Точка входа. Подключается последней, связывает всё вместе и запускает
 * приложение.
 *
 * Сделано на этапе 1: вход, восстановление сессии, выход, роль на <body>,
 * громкость. На этапе 2: первичная загрузка состояния, подписки realtime
 * и отрисовка. На этапе 3 — буззер, на этапе 4 — панель ведущего.
 */
Quiz.main = {
    /** Идёт ли загрузка прямо сейчас; см. loadGame. */
    loading: false,

    start: async function () {
        try {
            Quiz.db.init();
        } catch (err) {
            // Единственная ошибка, после которой продолжать нечем.
            Quiz.ui.login.setError(err.message);
            console.error(err);
            return;
        }

        // Раньше всего остального: слушатель первого касания должен стоять
        // прежде, чем по странице вообще станет по чему нажимать. Касание —
        // единственное, чем снимается запрет автоплея (js/audio.js).
        Quiz.audio.armUnlock();

        this.bindVolume();
        this.bindTextScale();
        Quiz.ui.buzzer.bind();
        Quiz.ui.sounds.bind();
        // Сразу, на пустом store: получится «ОЖИДАНИЕ», заблокировано. Роль
        // на <body> встаёт в enterGame раньше, чем доедет состояние игры, и
        // без этой строки телефон после F5 успевает показать доступную
        // «ЕСТЬ ОТВЕТ!» — секунду, но игроку, у которого идёт кулдаун.
        // Настоящая подпись придёт из render() в конце загрузки, когда
        // будет чем ответить на вопрос, есть кулдаун или нет.
        Quiz.ui.buzzer.render();
        Quiz.ui.users.bind();
        Quiz.ui.admin.bind();
        Quiz.ui.lightbox.bind();
        Quiz.ui.conn.bind();
        Quiz.ui.gate.bind();
        Quiz.dom.on('btn-logout', 'click', function () { Quiz.main.signOut(); });
        Quiz.ui.login.bind(function (profile) { Quiz.main.enterGame(profile); });

        // Смена активной игры — единственное, чего подписка не переживает:
        // она привязана к id. Оба пути ведут в одну и ту же loadGame.
        Quiz.realtime.onGameClosed = function () { Quiz.main.loadGame(); };
        Quiz.game.reload = function () { return Quiz.main.loadGame(); };

        // Канал переподключился после обрыва — перечитать пропущенное.
        Quiz.realtime.onRecovered = function () { return Quiz.main.refreshState(); };

        // Состояние связи — в полосу «переподключаюсь».
        Quiz.realtime.onStatus = function (connected) {
            Quiz.ui.conn.setConnected(connected);
        };

        // Телефон разбудили или вкладку вернули на экран. Пока экран был
        // погашен, таймеры стояли, а ведущий — нет: сверяемся сразу, не
        // дожидаясь очередного срабатывания сторожа.
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) Quiz.realtime.syncGame();
        });

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
    /** Сколько раз пробуем загрузить игру, прежде чем сдаться. */
    LOAD_RETRIES: 4,

    /** Базовая пауза между попытками, мс; растёт с номером попытки. */
    LOAD_RETRY_MS: 1500,

    enterGame: async function (profile) {
        var role = profile.role === 'admin' ? 'admin' : 'player';
        Quiz.dom.setRole(role);
        // Имя из профиля — только чтобы уголок не пустовал, пока грузится
        // игра. Дальше его ведёт отрисовка списка: ведущий может
        // переименовать человека посреди раунда, и в углу должно оказаться
        // то же имя, что на табло.
        Quiz.dom.setText('my-name', profile.display_name);
        Quiz.ui.login.hide();

        // Сессия могла восстановиться сама, и тогда игрок попадает в игру,
        // ни разу ничего не нажав, — а без касания браузер не даст зазвучать
        // джинглу. Шлюз добирает касание. Ждать его не надо: состояние
        // грузится под ним, и к нажатию экран уже готов.
        Quiz.ui.gate.maybeShow(role);

        // Часы — раньше всего, что покажет время: иначе первая отрисовка
        // обратного отсчёта уйдёт по часам телефона, а они врут. Промах по
        // часам не повод не грузить игру — отсчёт лишь разъедется на
        // смещение, а первый же буззер его пересинхронит (см. buzzer.js).
        await Quiz.timing.syncClock().catch(function () {});

        // Загрузка может не пройти с первого раза — устройство только вышло
        // из сна, сеть ещё не поднялась. Молчать об этом, как раньше (один
        // console.error), нельзя: экран остаётся пустым «ОЖИДАНИЕМ», и игрок
        // не знает, что делать. Пробуем несколько раз с нарастающей паузой,
        // а не вышло — показываем полосу потери связи с кнопкой «Обновить».
        for (var attempt = 1; ; attempt++) {
            try {
                await this.loadGame();
                return;
            } catch (err) {
                console.warn('Загрузка игры не удалась, попытка ' + attempt +
                             ':', err.message);
                if (attempt >= this.LOAD_RETRIES) {
                    Quiz.ui.conn.setConnected(false);
                    return;
                }
                await this.delay(this.LOAD_RETRY_MS * attempt);
            }
        }
    },

    delay: function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
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
        // Загрузку умеют начать двое: ведущий, переключивший игру, и
        // подписка, увидевшая, что игра сменила статус. Оба узнают об
        // одном и том же событии, поэтому второму делать нечего — он всё
        // равно прочитал бы ровно то, что читает первый.
        if (this.loading) return;
        this.loading = true;
        try {
            await this.loadGameOnce();
        } finally {
            this.loading = false;
        }
    },

    loadGameOnce: async function () {
        var game = await Quiz.db.getActiveGame();

        // Идущей может оказаться уже другая игра, поэтому сначала убираем
        // всё, что осталось от прошлой, и только потом раскладываем новое.
        // На первой загрузке обе строчки ничего не делают.
        Quiz.realtime.unsubscribe();
        Quiz.store.reset();

        Quiz.store.game = game;
        Quiz.timing.applyGameRow(game);

        // Звуки к игре не привязаны и переживают её смену, поэтому reset()
        // их не трогал. Читаются они всё равно здесь: это единственная
        // точка, через которую проходит и первый вход, и переезд на другую
        // игру. Прогрев сразу за чтением — джингл буззера обязан звучать
        // без похода в сеть.
        Quiz.store.sounds = await Quiz.db.getSounds();
        Quiz.audio.warmUp();

        if (Quiz.store.isAdmin()) {
            Quiz.store.games = await Quiz.db.getMyGames(Quiz.store.profile.id);
        }

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

        await Quiz.realtime.reloadQuestionScoped();

        Quiz.realtime.onChange = function () { Quiz.main.render(); };

        // Рисуем наполненный store СРАЗУ, ещё до ожидания подписки. Раньше
        // единственная полная отрисовка стояла за `await subscribe()`, и
        // если канал не вставал — мёртвая сеть, уснувшая машина, — экран
        // оставался на пустой предзагрузочной «ОЖИДАНИИ»: store наполнен, а
        // на нём это не показано. Ровно так час просидел игрок, у которого
        // подписка не поднялась и `subscribe()` не разрешился.
        this.render();

        // Подтверждения подписки всё равно дожидаемся: всё, что ведущий
        // сделает сразу после загрузки (импорт, листание вопросов), должно
        // вернуться к нему через уже готовую подписку, а не пройти мимо неё
        // (гонка из docs/decisions.md, этап 5). Экран к этому моменту уже
        // отрисован, поэтому медленная подписка больше не оставляет игрока
        // перед пустым «ОЖИДАНИЕМ».
        await Quiz.realtime.subscribe(game.id);

        this.render();
    },

    /**
     * Перечитать состояние текущей игры, не трогая живую подписку. Зовётся
     * после того, как realtime переподключился: события, пропущенные за
     * время простоя, SDK не доигрывает, поэтому store освежаем сами.
     *
     * Если активная игра успела смениться или закрыться, пока связи не
     * было, — это уже случай полной перезагрузки с новой подпиской, её и
     * зовём вместо точечной перечитки.
     */
    refreshState: async function () {
        // Повторяем так же и тем же, чем enterGame, и по той же причине:
        // связь только что поднялась после обрыва, то есть это ровно тот
        // момент, когда запрос скорее всего не дойдёт. Одного console.warn
        // здесь мало — второго события, которое исправило бы положение, не
        // будет: канал-то живой, переподключаться больше нечему, и store
        // остался бы отставшим до перезагрузки страницы.
        for (var attempt = 1; ; attempt++) {
            try {
                await this.refreshStateOnce();
                return;
            } catch (err) {
                console.warn('Не удалось освежить состояние после ' +
                             'переподключения, попытка ' + attempt + ':',
                             err.message);
                if (attempt >= this.LOAD_RETRIES) return;
                await this.delay(this.LOAD_RETRY_MS * attempt);
            }
        }
    },

    refreshStateOnce: async function () {
        var game = await Quiz.db.getActiveGame();
        if (!game || game.status !== 'running' ||
            !Quiz.store.game || game.id !== Quiz.store.game.id) {
            await this.loadGame();
            return;
        }
        Quiz.store.game = game;
        Quiz.timing.applyGameRow(game);
        await Quiz.realtime.reloadQuestionScoped();
        this.render();
    },

    render: function () {
        Quiz.ui.question.render();
        // После вопроса: закрывает просмотр, если картинка под ним сменилась.
        Quiz.ui.lightbox.render();
        Quiz.ui.players.render();
        Quiz.ui.buzzer.render();
        Quiz.ui.stats.render();
        Quiz.ui.sounds.render();
        Quiz.ui.users.render();
        Quiz.ui.admin.render();
    },

    showLogin: function () {
        Quiz.realtime.unsubscribe();
        // Иначе интервалы отсчёта переживут выход и продолжат тикать.
        Quiz.ui.buzzer.stopTicking();
        Quiz.ui.players.stopTicking();
        Quiz.dom.setRole('unknown');
        // Экран входа лежит выше просмотра картинки и накрыл бы его собой,
        // а после следующего входа тот вынырнул бы обратно.
        Quiz.ui.lightbox.close();
        // Полосе «переподключаюсь» на экране входа делать нечего: связь с
        // игрой мы разорвали сами.
        Quiz.ui.conn.hide();
        // Шлюз экран входа и так перекрывает, но оставленный открытым он
        // вынырнул бы поверх игры после следующего входа.
        Quiz.ui.gate.hide();
        // Чужое имя не должно мелькнуть в шапке при следующем входе.
        Quiz.dom.setText('my-name', '');
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
    },

    /**
     * Кнопки A− / A+ у области вопроса. Как и громкость, настройка живёт
     * на устройстве и от состояния игры не зависит, поэтому вешаем один
     * раз здесь, а не из отрисовки. На границах гасим соответствующую
     * кнопку, чтобы нажатие впустую не читалось как поломка.
     */
    bindTextScale: function () {
        Quiz.textScale.load();

        var refresh = function () {
            Quiz.dom.el('btn-text-smaller').disabled = Quiz.textScale.atMin();
            Quiz.dom.el('btn-text-bigger').disabled = Quiz.textScale.atMax();
        };

        Quiz.dom.on('btn-text-smaller', 'click', function () {
            Quiz.textScale.bump(-1);
            refresh();
        });
        Quiz.dom.on('btn-text-bigger', 'click', function () {
            Quiz.textScale.bump(1);
            refresh();
        });
        refresh();
    }
};

window.addEventListener('DOMContentLoaded', function () {
    console.log('Quiz', Quiz.VERSION);
    Quiz.main.start();
});
