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
    }

    // --- Запросы добавляются сюда по мере готовности функций. Планируемый набор:
    //
    //   getGame(gameId)               -> строка game
    //   getQuestions(gameId)          -> строки question по порядку
    //   getParticipants(gameId)       -> строки participant
    //   getCurrentBuzz(gameId)        -> строка buzz или null
    //   getAnswerLog(questionId)      -> строки answer_log для бейджа
    //   getRevealedAnswer(questionId) -> строка question_answer; RLS не вернёт
    //                                    ничего, пока ведущий не открыл ответ
    //   replaceQuestions(gameId, qs)  -> стереть и залить заново из Excel
    //   setCurrentQuestion(...)       -> навигация ведущего
    //   insertBuzz(gameId, partId)    -> атомарный захват слота, см. js/buzzer.js
};
