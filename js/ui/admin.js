/**
 * Шапка ведущего: строка управления и выбор игры.
 *
 * Здесь же спрашиваются подтверждения. Само действие в js/game.js ничего
 * не спрашивает — вопрос задаёт тот, у кого есть экран.
 *
 * Диалоги нарочно системные (prompt/confirm). Своя модалка ради двух
 * полей у ведущего за ноутбуком — это разметка, стили и фокус-ловушка,
 * которые нечем оправдать; телефона всё это не касается.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.admin = {
    /**
     * Тексты отказов импорта. Причину кодом отдаёт Quiz.excel, переводит
     * её на человеческий интерфейс — как и на экране входа.
     */
    IMPORT_MESSAGES: {
        library: 'Не загрузилась библиотека чтения Excel. Проверьте подключение к сети.',
        format:  'Не похоже на файл Excel — откройте его и сохраните как .xlsx.',
        empty:   'В файле нет строк с вопросами. Первая строка считается заголовком.',
        unknown: 'Не удалось загрузить вопросы'
    },

    /** Из чего собран текущий список игр — чтобы не пересобирать зря. */
    gamesSignature: null,

    bind: function () {
        Quiz.dom.on('btn-prev', 'click', function () { Quiz.game.prev(); });
        Quiz.dom.on('btn-next', 'click', function () { Quiz.game.next(); });
        Quiz.dom.on('btn-toggle-answer', 'click', function () { Quiz.game.toggleAnswer(); });
        Quiz.dom.on('btn-reset-penalties', 'click', function () { Quiz.game.clearPenalties(); });
        Quiz.dom.on('btn-intro', 'click', function () { Quiz.game.playIntro(); });

        Quiz.dom.on('btn-add-player', 'click', function () {
            var name = window.prompt('Имя игрока без аккаунта:');
            if (name) Quiz.game.addOfflinePlayer(name);
        });

        Quiz.dom.on('btn-new-game', 'click', function () {
            var title = window.prompt('Название новой игры:');
            if (title) Quiz.game.createGame(title);
        });

        Quiz.dom.on('btn-restart', 'click', function () {
            // Необратимо: вместе с вопросами каскадом уходят ответы и журнал.
            var ok = window.confirm(
                'Сброс игры сотрёт все вопросы и обнулит счёт. Продолжить?'
            );
            if (ok) Quiz.game.restart();
        });

        Quiz.dom.on('input-xlsx', 'change', function (event) {
            var input = event.target;
            var file = input.files[0];
            // Сброс сразу: иначе повторный выбор того же файла не даст
            // события, и «загрузить ещё раз» после ошибки не сработает.
            input.value = '';
            if (file) Quiz.ui.admin.importFile(file);
        });

        Quiz.dom.on('select-game', 'change', function (event) {
            var id = event.target.value;
            if (id && id !== (Quiz.store.game || {}).id) {
                Quiz.game.makeActive(id);
            }
        });
    },

    /**
     * Загрузка файла с вопросами.
     *
     * Импорт заменяет набор целиком, поэтому спрашиваем — но только когда
     * есть что терять. На пустой игре, куда вопросы и грузят, лишний
     * вопрос «вы уверены?» только мешает.
     */
    importFile: async function (file) {
        if (!Quiz.store.game) {
            window.alert('Сначала выберите или создайте игру.');
            return;
        }
        if (Quiz.store.questions.length) {
            // Формулировка обходит склонение числительного: «заменит все
            // 2 вопроса» и «все 5 вопросов» требуют разных форм, а плодить
            // ради одной строки согласование числительных незачем.
            var ok = window.confirm(
                'Загрузка заменит вопросы этой игры (сейчас их ' +
                Quiz.store.questions.length + '). Продолжить?'
            );
            if (!ok) return;
        }

        try {
            var count = await Quiz.game.importQuestions(file);
            window.alert('Загружено вопросов: ' + count);
        } catch (err) {
            window.alert(this.IMPORT_MESSAGES[err.reason] || this.IMPORT_MESSAGES.unknown);
            // warn, а не error: отказ разобранный и показанный человеку —
            // это не сбой приложения. Так же поступает экран входа.
            console.warn('Импорт не удался:', err.reason, err.message);
        }
    },

    render: function () {
        if (!Quiz.store.isAdmin()) return;

        var store = Quiz.store;
        var current = store.currentQuestion();
        var last = store.questions.length - 1;

        // Кнопка показа ответа — единственная с состоянием: подпись должна
        // говорить, что случится по нажатию, а не что происходит сейчас.
        var revealed = !!(store.game && store.game.show_answer);
        Quiz.dom.setText('btn-toggle-answer', revealed ? 'Скрыть' : 'Ответ');
        Quiz.dom.el('btn-toggle-answer').classList.toggle('is-on', revealed);

        // За краем списка идти некуда. Из «вопрос не выбран» вперёд можно:
        // это переход на первый.
        Quiz.dom.el('btn-prev').disabled = !current || current.position === 0;
        Quiz.dom.el('btn-next').disabled = !store.questions.length ||
            (!!current && current.position >= last);

        this.renderGames();
    },

    /**
     * Список игр ведущего.
     *
     * Пересобирается только когда состав действительно изменился: замена
     * <option> сбрасывает открытый список, а ведущий как раз в нём и
     * выбирает.
     */
    renderGames: function () {
        var select = Quiz.dom.el('select-game');
        var games = Quiz.store.games || [];
        var signature = games.map(function (g) {
            return g.id + ':' + (g.title || '');
        }).join('|');

        if (signature !== this.gamesSignature) {
            this.gamesSignature = signature;
            select.textContent = '';
            games.forEach(function (game) {
                var option = document.createElement('option');
                option.value = game.id;
                option.textContent = game.title || 'Без названия';
                select.appendChild(option);
            });
        }

        select.value = (Quiz.store.game || {}).id || '';
    }
};
