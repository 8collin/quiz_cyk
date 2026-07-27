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

    /** Строки question текущей игры, по порядку. */
    questions: [],

    /** Строки participant без порядка — интерфейс сортирует свою копию. */
    participants: [],

    /** Единственная активная строка buzz или null, когда никто не отвечает. */
    buzz: null,

    /** Строки answer_log по текущему вопросу, для бейджа со звёздочкой. */
    answerLog: [],

    /** Открытый ответ на текущий вопрос; null, пока ведущий его не показал. */
    revealedAnswer: null,

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

    reset: function () {
        this.game = null;
        this.questions = [];
        this.participants = [];
        this.buzz = null;
        this.answerLog = [];
        this.revealedAnswer = null;
    }
};
