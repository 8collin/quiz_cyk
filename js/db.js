/**
 * Клиент Supabase и все запросы приложения.
 *
 * Имена таблиц и колонок живут только в этом файле. Ничто выше не должно
 * упоминать `.from('participant')` или строковое имя колонки — если схема
 * поедет, правится один файл.
 */
Quiz.db = {
    client: null,

    init: function () {
        var cfg = Quiz.config;
        if (cfg.SUPABASE_URL.indexOf('PASTE_') === 0) {
            throw new Error(
                'Supabase не настроен: впишите URL и anon key в js/config.js'
            );
        }
        this.client = window.supabase.createClient(
            cfg.SUPABASE_URL,
            cfg.SUPABASE_ANON_KEY
        );
        return this.client;
    },

    /**
     * Разворачивает обёртку { data, error }, чтобы вызывающий код просто
     * ждал значение. Ошибка бросается с сохранением кода Postgres в
     * `err.code` — на него опирается буззер, чтобы отличить 23505 (меня
     * опередили) от P0001 (ещё на кулдауне).
     */
    unwrap: function (result) {
        if (result.error) {
            var err = new Error(result.error.message);
            err.code = result.error.code;
            err.details = result.error.details;
            throw err;
        }
        return result.data;
    },

    /** Профиль пользователя. null, если строки нет. */
    getProfile: async function (userId) {
        return this.unwrap(
            await this.client
                .from('profile')
                .select('id, display_name, role')
                .eq('id', userId)
                .maybeSingle()
        );
    },

    /**
     * Идущая игра — самая свежая со статусом `running`.
     *
     * Заглушка до этапа 4, где у ведущего появится создание игры и выбор
     * активной. Отдельная настройка с id игры была бы ровно таким же
     * временным решением, только его пришлось бы ещё и вычищать из конфига.
     */
    getActiveGame: async function () {
        return this.unwrap(
            await this.client
                .from('game')
                .select('*')
                .eq('status', 'running')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
        );
    },

    /**
     * Заводит вошедшему игроку строку participant и возвращает её id.
     * Идемпотентна, поэтому зовётся при каждом старте не глядя.
     */
    joinGame: async function (gameId) {
        return this.unwrap(
            await this.client.rpc('join_game', { p_game_id: gameId })
        );
    },

    /** Строка game по id — перечитка после того, как база нас поправила. */
    getGame: async function (gameId) {
        return this.unwrap(
            await this.client
                .from('game')
                .select('*')
                .eq('id', gameId)
                .maybeSingle()
        );
    },

    /**
     * Захват слота отвечающего.
     *
     * Ошибку не глотаем и не переводим: по её коду вызывающий отличает
     * «опередили» (23505) от «кулдаун ещё идёт» (P0001), а это два разных
     * поведения. unwrap кладёт код в err.code.
     */
    insertBuzz: async function (gameId, participantId) {
        return this.unwrap(
            await this.client
                .from('buzz')
                .insert({ game_id: gameId, participant_id: participantId })
        );
    },

    /** Вопросы игры по возрастанию position. */
    getQuestions: async function (gameId) {
        return this.unwrap(
            await this.client
                .from('question')
                .select('id, position, text, image_url')
                .eq('game_id', gameId)
                .order('position', { ascending: true })
        );
    },

    getParticipants: async function (gameId) {
        return this.unwrap(
            await this.client
                .from('participant')
                .select('id, profile_id, display_name, score, penalty_until_ms, sound_key')
                .eq('game_id', gameId)
        );
    },

    /** Кто отвечает прямо сейчас. null, когда слот свободен. */
    getCurrentBuzz: async function (gameId) {
        return this.unwrap(
            await this.client
                .from('buzz')
                .select('id, game_id, participant_id, created_at')
                .eq('game_id', gameId)
                .maybeSingle()
        );
    },

    getAnswerLog: async function (questionId) {
        return this.unwrap(
            await this.client
                .from('answer_log')
                .select('id, question_id, participant_id, delta, created_at')
                .eq('question_id', questionId)
        );
    },

    /**
     * Ответ на вопрос — если его вообще разрешено видеть.
     *
     * Никакой проверки «а показал ли ведущий» здесь нет и быть не должно:
     * решает политика question_answer_select_when_revealed. Ведущему строка
     * приходит всегда, игроку — только пока это текущий вопрос и выставлен
     * show_answer. Пустой ответ здесь означает «нельзя», а не «нет данных».
     */
    getRevealedAnswer: async function (questionId) {
        return this.unwrap(
            await this.client
                .from('question_answer')
                .select('question_id, text, image_url')
                .eq('question_id', questionId)
                .maybeSingle()
        );
    },

    // --- Записи ведущего -------------------------------------------------
    //
    // Всё, что ниже, доступно только ведущему: политики `*_admin_all`
    // отвергнут эти запросы у игрока, а интерфейс до них и не доберётся.
    // Помните, что отвергнутый политикой UPDATE не бросает ошибку — он
    // молча меняет ноль строк.

    /**
     * Указатель на текущий вопрос.
     *
     * Показ ответа снимается той же записью: он относится к конкретному
     * вопросу, и оставить его включённым при переходе значило бы открыть
     * игрокам следующий ответ до того, как они увидят вопрос.
     */
    setCurrentQuestion: async function (gameId, questionId) {
        return this.unwrap(
            await this.client
                .from('game')
                .update({ current_question_id: questionId, show_answer: false })
                .eq('id', gameId)
        );
    },

    setShowAnswer: async function (gameId, value) {
        return this.unwrap(
            await this.client
                .from('game')
                .update({ show_answer: !!value })
                .eq('id', gameId)
        );
    },

    /** Сброс оси, личных кулдаунов и слота отвечающего — одной функцией. */
    resetThinking: async function (gameId) {
        return this.unwrap(
            await this.client.rpc('reset_thinking', { p_game_id: gameId })
        );
    },

    /** Отмена одного случайного нажатия: шаг штрафа назад плюс слот. */
    reducePenalty: async function (participantId) {
        return this.unwrap(
            await this.client.rpc('reduce_penalty', { p_participant_id: participantId })
        );
    },

    /**
     * Оценка ведущего. Счёт и штраф начисляет триггер
     * answer_applies_effects — здесь только факт ответа.
     */
    insertAnswer: async function (gameId, questionId, participantId, delta) {
        return this.unwrap(
            await this.client
                .from('answer_log')
                .insert({
                    game_id: gameId,
                    question_id: questionId,
                    participant_id: participantId,
                    delta: delta
                })
        );
    },

    /** Освобождение слота. Строка в игре одна, поэтому фильтр по игре. */
    deleteBuzz: async function (gameId) {
        return this.unwrap(
            await this.client.from('buzz').delete().eq('game_id', gameId)
        );
    },

    /** Игрок без аккаунта: profile_id остаётся null, счёт ведёт ведущий. */
    addParticipant: async function (gameId, displayName) {
        return this.unwrap(
            await this.client
                .from('participant')
                .insert({ game_id: gameId, display_name: displayName })
        );
    },

    deleteParticipant: async function (participantId) {
        return this.unwrap(
            await this.client.from('participant').delete().eq('id', participantId)
        );
    },

    /** Счёт в ноль. Кулдауны обнуляет reset_thinking, здесь их не трогаем. */
    resetScores: async function (gameId) {
        return this.unwrap(
            await this.client
                .from('participant')
                .update({ score: 0 })
                .eq('game_id', gameId)
        );
    },

    /**
     * Стирает вопросы игры.
     *
     * Каскадами уходит и всё, что на них ссылается: ответы
     * (question_answer) и журнал (answer_log). Указатель
     * game.current_question_id обнуляется сам — внешний ключ объявлен
     * `on delete set null`.
     */
    deleteQuestions: async function (gameId) {
        return this.unwrap(
            await this.client.from('question').delete().eq('game_id', gameId)
        );
    },

    /**
     * Заменяет вопросы игры целиком — импорт из Excel.
     *
     * Принимает [{ text, answerText, imageUrl, answerImageUrl }], то есть
     * разобранные строки, а не ячейки: про формат файла знает js/excel.js,
     * про имена столбцов — этот файл, и знать друг про друга им незачем.
     *
     * Двумя запросами, а не одним, потому что id вопросов выдаёт база:
     * ответы можно разложить только после того, как они вернулись. Зато
     * весь набор уходит целиком — по строчке за раз не пишем.
     */
    replaceQuestions: async function (gameId, rows) {
        await this.deleteQuestions(gameId);
        if (!rows.length) return [];

        var questions = rows.map(function (row, index) {
            return {
                game_id:   gameId,
                position:  index,
                text:      row.text,
                image_url: row.imageUrl
            };
        });

        var inserted = this.unwrap(
            await this.client.from('question').insert(questions).select('id, position')
        );

        // Сопоставляем по position, а не по порядку возврата: порядок строк
        // в ответе PostgREST не обещан, и молчаливая перестановка развела бы
        // вопросы с ответами.
        var answers = inserted.map(function (question) {
            var row = rows[question.position];
            return {
                question_id: question.id,
                text:        row.answerText,
                image_url:   row.answerImageUrl
            };
        });

        return this.unwrap(
            await this.client.from('question_answer').insert(answers)
        );
    },

    // --- Игры ------------------------------------------------------------

    /** Игры этого ведущего, свежие сверху — для выбора активной. */
    getMyGames: async function (hostId) {
        return this.unwrap(
            await this.client
                .from('game')
                .select('id, title, status, created_at')
                .eq('host_id', hostId)
                .order('created_at', { ascending: false })
        );
    },

    /** Новая игра сразу идущая: заводят её, чтобы играть, а не отложить. */
    createGame: async function (title, hostId) {
        return this.unwrap(
            await this.client
                .from('game')
                .insert({ title: title, host_id: hostId, status: 'running' })
                .select('*')
                .maybeSingle()
        );
    },

    setGameStatus: async function (gameId, status) {
        return this.unwrap(
            await this.client.from('game').update({ status: status }).eq('id', gameId)
        );
    },

    /**
     * Снимает `running` со всех остальных игр ведущего.
     *
     * Идущая игра обязана быть одна: именно по ней getActiveGame() находит
     * игру для игроков, и второй running сделал бы выбор случайным.
     */
    demoteOtherGames: async function (gameId, hostId) {
        return this.unwrap(
            await this.client
                .from('game')
                .update({ status: 'lobby' })
                .eq('host_id', hostId)
                .eq('status', 'running')
                .neq('id', gameId)
        );
    }
};
