/**
 * In-memory mirror of the game.
 *
 * Everything the UI paints reads from here, and only realtime handlers
 * and explicit reloads write here. Keeping that one-way street is what
 * stops the "who is answering" highlight from disagreeing with the
 * buzzer state, which is the classic bug in this kind of app.
 *
 * Nothing in this file talks to the network.
 */
Quiz.store = {
    /** Signed-in user: { id, display_name, role }. */
    profile: null,

    /** The game row. */
    game: null,

    /** Ordered question rows for the current game. */
    questions: [],

    /** Participant rows, unordered — the UI sorts its own copy. */
    participants: [],

    /** The single active buzz row, or null when nobody is answering. */
    buzz: null,

    /** answer_log rows for the current question, for the ⭐ badge. */
    answerLog: [],

    /** Revealed answer for the current question; null until the host shows it. */
    revealedAnswer: null,

    isAdmin: function () {
        return !!this.profile && this.profile.role === 'admin';
    },

    currentQuestion: function () {
        if (!this.game || !this.game.current_question_id) return null;
        var id = this.game.current_question_id;
        return this.questions.find(function (q) { return q.id === id; }) || null;
    },

    /** 1-based position of the current question, for "ВОПРОС 3 / 20". */
    currentNumber: function () {
        var q = this.currentQuestion();
        return q ? q.position + 1 : 0;
    },

    /** The signed-in user's participant row in this game, if any. */
    myParticipant: function () {
        if (!this.profile) return null;
        var myId = this.profile.id;
        return this.participants.find(function (p) {
            return p.profile_id === myId;
        }) || null;
    },

    /** True when the signed-in player is the one holding the buzzer. */
    amIAnswering: function () {
        var mine = this.myParticipant();
        return !!this.buzz && !!mine && this.buzz.participant_id === mine.id;
    },

    /** Accepted answers by this participant on the current question. */
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
