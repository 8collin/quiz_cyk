/**
 * Действия ведущего. Игроку отсюда недоступно ничего: интерфейс прячет
 * элементы управления, а RLS-политики всё равно отвергнут запись.
 *
 * Этот файл только меняет состояние в базе и никогда не пишет в
 * Quiz.store — обратно всё приезжает через realtime, тем же путём, что и
 * на экраны игроков. Ведущий, у которого своя правка отражается мгновенно,
 * а чужая через подписку, — это два источника правды и расхождение,
 * которое проявится один раз в середине игры.
 *
 * Подтверждения («правда стереть?») живут в js/ui/admin.js: здесь голое
 * действие, спрашивает тот, у кого есть экран.
 */
Quiz.game = {
    /**
     * Ставится из main.js: как перечитать игру целиком.
     *
     * Нужно там, где меняется сама активная игра, — подписка realtime
     * привязана к конкретному id и про переезд узнать не может.
     */
    reload: async function () {},

    // --- Навигация по вопросам -------------------------------------------

    /**
     * Переход к вопросу с указанным номером (position, с нуля).
     *
     * Порядок двух запросов существенный. Сначала чистим ось, слот и
     * штрафы, и только потом двигаем указатель: тогда перечитка в
     * realtime.handleGame() увидит уже прибранное состояние. В обратном
     * порядке она успевает прочитать буззер от прошлого вопроса, и
     * подсветка «отвечает» залипает до следующего события — ровно та
     * болячка, которой славилась предыдущая версия.
     */
    goToQuestion: async function (position) {
        var game = Quiz.store.game;
        if (!game) return;

        var question = Quiz.store.questions.find(function (q) {
            return q.position === position;
        });
        // За краем списка делать нечего. Кнопки там и так погашены, но
        // вызвать goToQuestion можно и из консоли.
        if (!question) return;

        await Quiz.db.resetThinking(game.id);
        await Quiz.db.setCurrentQuestion(game.id, question.id);
    },

    /** Вперёд, а из «вопрос не выбран» — на первый. */
    next: function () {
        var current = Quiz.store.currentQuestion();
        return this.goToQuestion(current ? current.position + 1 : 0);
    },

    prev: function () {
        var current = Quiz.store.currentQuestion();
        if (!current) return Promise.resolve();
        return this.goToQuestion(current.position - 1);
    },

    /**
     * Показать или спрятать ответ.
     *
     * Меняется один флаг в строке game — и этого достаточно: читать
     * question_answer игроку разрешает политика, которая на этот флаг и
     * смотрит. До нажатия строки с ответом для его сессии просто нет.
     */
    toggleAnswer: function () {
        var game = Quiz.store.game;
        if (!game) return Promise.resolve();
        return Quiz.db.setShowAnswer(game.id, !game.show_answer);
    },

    // --- Оценка -----------------------------------------------------------

    /**
     * Оценить ответ: −1, 0 или +1.
     *
     * Счёт и штраф навесит триггер answer_applies_effects, здесь только
     * запись факта и освобождение слота.
     *
     * Порядок опять существенный. Пока слот занят, ось заморожена, и штраф
     * отсчитывается от того же T, на котором игрок нажал. Освободи слот
     * раньше — ось тронется, и штраф выйдет короче на длину этих двух
     * запросов.
     */
    score: async function (participantId, delta) {
        var game = Quiz.store.game;
        if (!game) return;
        if (!game.current_question_id) {
            console.warn('Оценка без выбранного вопроса: записывать некуда.');
            return;
        }

        await Quiz.db.insertAnswer(
            game.id, game.current_question_id, participantId, delta
        );

        var buzz = Quiz.store.buzz;
        if (buzz && buzz.participant_id === participantId) {
            await Quiz.db.deleteBuzz(game.id);
        }
    },

    /**
     * Снять отвечающего, ничего не оценивая.
     *
     * Намеренно не пишет в журнал: это не попытка, штрафа не будет и на
     * кулдаун игрока это не влияет. Пригождается, когда игрок нажал и тут
     * же сказал «не то».
     */
    releaseBuzz: function () {
        var game = Quiz.store.game;
        if (!game) return Promise.resolve();
        return Quiz.db.deleteBuzz(game.id);
    },

    /** Обнулить ожидание у всех разом. */
    clearPenalties: function () {
        var game = Quiz.store.game;
        if (!game) return Promise.resolve();
        return Quiz.db.resetThinking(game.id);
    },

    // --- Участники --------------------------------------------------------

    removeParticipant: function (participantId) {
        return Quiz.db.deleteParticipant(participantId);
    },

    // --- Вопросы ----------------------------------------------------------

    /**
     * Импорт из Excel. Возвращает число загруженных вопросов.
     *
     * Разбор идёт до первой записи: из битого файла в базу не должно
     * попасть ничего, в том числе половины набора.
     *
     * После заливки перечитываем игру целиком — таблица `question` в
     * публикацию realtime не входит, и без этого свежие вопросы не
     * появились бы даже у самого ведущего. И сразу встаём на первый:
     * прошлый указатель обнулился вместе со старыми строками, а показывать
     * «вопрос не выбран» после успешной загрузки незачем.
     */
    importQuestions: async function (file) {
        var game = Quiz.store.game;
        if (!game) return 0;

        var rows = await Quiz.excel.parse(file);
        await Quiz.db.replaceQuestions(game.id, rows);

        await this.reload();
        await this.goToQuestion(0);
        return rows.length;
    },

    // --- Игра целиком -----------------------------------------------------

    /**
     * Новая игра. Заводится сразу идущей и сразу становится активной —
     * заводят её, чтобы играть.
     */
    createGame: async function (title) {
        var profile = Quiz.store.profile;
        var clean = (title || '').trim();
        if (!profile || !clean) return;

        var game = await Quiz.db.createGame(clean, profile.id);
        await this.makeActive(game.id);
    },

    /**
     * Сделать игру активной.
     *
     * Порядок двух запросов — не косметика. Сначала новая игра получает
     * `running`, и только потом старая его теряет. В обратном порядке
     * между запросами есть момент, когда идущей игры нет вовсе, — и игрок,
     * среагировавший на снятие статуса, не найдёт, куда переходить, и
     * останется на экране «игра не найдена» насовсем.
     */
    makeActive: async function (gameId) {
        var profile = Quiz.store.profile;
        if (!profile) return;

        await Quiz.db.setGameStatus(gameId, 'running');
        await Quiz.db.demoteOtherGames(gameId, profile.id);
        await this.reload();
    },

    /**
     * Сброс игры: счёт в ноль, вопросы стереть, ось сбросить.
     *
     * Необратимо — вместе с вопросами каскадом уходят ответы и журнал.
     * Спрашивает подтверждение вызывающий, см. js/ui/admin.js.
     *
     * Вопросы стираются первыми: указатель current_question_id обнулится
     * сам (внешний ключ объявлен `on delete set null`), а эта правка
     * строки game и разбудит подписки на всех экранах.
     */
    restart: async function () {
        var game = Quiz.store.game;
        if (!game) return;

        await Quiz.db.deleteQuestions(game.id);
        await Quiz.db.resetScores(game.id);
        await Quiz.db.resetThinking(game.id);
        await Quiz.db.setShowAnswer(game.id, false);
        await this.reload();
    },

    /** Интро играет у всех разом; своё воспроизведение — своими руками. */
    playIntro: function () {
        Quiz.audio.play(Quiz.config.INTRO_SOUND);
        Quiz.realtime.sendIntro();
    }
};
