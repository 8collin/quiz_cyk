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
    }

    // --- Запросы добавляются сюда по мере готовности функций. Планируемый набор:
    //
    //   replaceQuestions(gameId, qs)  -> стереть и залить заново из Excel
    //   setCurrentQuestion(...)       -> навигация ведущего
    //   insertBuzz(gameId, partId)    -> атомарный захват слота, см. js/buzzer.js
};
