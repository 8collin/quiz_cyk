/**
 * Зеркало состояния игры в памяти.
 *
 * Всё, что рисует интерфейс, читается отсюда, а пишут сюда только
 * обработчики realtime и явные перезагрузки. Соблюдение этого
 * одностороннего движения — то, что не даёт подсветке «кто отвечает»
 * разойтись с состоянием буззера, а это классический баг таких приложений.
 *
 * Ничто в этом файле не ходит в сеть.
 */
Quiz.store = {
    /** Вошедший пользователь: { id, display_name, role }. */
    profile: null,

    /** Строка game. */
    game: null,

    /** Игры ведущего для выбора активной. У игрока всегда пусто. */
    games: [],

    /** Строки question текущей игры, по порядку. */
    questions: [],

    /** Строки participant без порядка — интерфейс сортирует свою копию. */
    participants: [],

    /** Единственная активная строка buzz или null, когда никто не отвечает. */
    buzz: null,

    /** Строки answer_log по текущему вопросу, для бейджа со звёздочкой. */
    answerLog: [],

    /** Строки answer_log по всей игре, для таблицы статистики. */
    gameAnswerLog: [],

    /** Открытый ответ на текущий вопрос; null, пока ведущий его не показал. */
    revealedAnswer: null,

    /**
     * Строки sound. Игре не принадлежат — это общий на всё развёртывание
     * набор джинглов, поэтому reset() их не трогает.
     */
    sounds: [],

    isAdmin: function () {
        return !!this.profile && this.profile.role === 'admin';
    },

    currentQuestion: function () {
        if (!this.game || !this.game.current_question_id) return null;
        var id = this.game.current_question_id;
        return this.questions.find(function (q) { return q.id === id; }) || null;
    },

    /** Номер текущего вопроса с единицы, для «ВОПРОС 3 / 20». */
    currentNumber: function () {
        var q = this.currentQuestion();
        return q ? q.position + 1 : 0;
    },

    /** Строка participant вошедшего пользователя в этой игре, если есть. */
    myParticipant: function () {
        if (!this.profile) return null;
        var myId = this.profile.id;
        return this.participants.find(function (p) {
            return p.profile_id === myId;
        }) || null;
    },

    /** true, когда буззер держит именно вошедший игрок. */
    amIAnswering: function () {
        var mine = this.myParticipant();
        return !!this.buzz && !!mine && this.buzz.participant_id === mine.id;
    },

    /** Сколько раз участник отвечал на текущий вопрос. */
    answerCountFor: function (participantId) {
        return this.answerLog.filter(function (a) {
            return a.participant_id === participantId;
        }).length;
    },

    /** Звук по ключу. null, когда такого нет — звать будут `default`. */
    soundFor: function (key) {
        if (!key) return null;
        return this.sounds.find(function (s) { return s.key === key; }) || null;
    },

    /** Оценки, у которых в таблице статистики своя колонка, по порядку. */
    STAT_DELTAS: [-1, 0, 1, 2],

    /**
     * Таблица статистики: строка на каждого участника игры.
     *
     * Считается из gameAnswerLog, то есть из журнала, а не из
     * participant.score. Обе величины должны сойтись — счёт ведёт триггер
     * answer_applies_effects как накопительную сумму тех же дельт, — и
     * пусть это будет вторая, независимо посчитанная копия: разойдутся
     * они только если в базу писали мимо игры.
     *
     * Строки отдаются в порядке табло игрока: больше очков выше, при
     * равенстве по имени. Порядок обязан быть полным, иначе строки
     * прыгают местами при каждой перерисовке.
     *
     * Участники без единой оценки остаются в таблице с нулями: «не
     * отвечал» — это тоже результат, а исчезнувшая строка читалась бы
     * как сбой.
     */
    stats: function () {
        var log = this.gameAnswerLog;
        var deltas = this.STAT_DELTAS;

        var rows = this.participants.map(function (participant) {
            var mine = log.filter(function (a) {
                return a.participant_id === participant.id;
            });
            return {
                id: participant.id,
                name: participant.display_name,
                counts: deltas.map(function (delta) {
                    return mine.filter(function (a) { return a.delta === delta; }).length;
                }),
                score: mine.reduce(function (sum, a) { return sum + a.delta; }, 0)
            };
        });

        return rows.sort(function (a, b) {
            return (b.score - a.score) || a.name.localeCompare(b.name, 'ru');
        });
    },

    reset: function () {
        this.game = null;
        this.games = [];
        this.questions = [];
        this.participants = [];
        this.buzz = null;
        this.answerLog = [];
        this.gameAnswerLog = [];
        this.revealedAnswer = null;
    }
};
