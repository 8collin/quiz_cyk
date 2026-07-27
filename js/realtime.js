/**
 * Подписки realtime — единственное, что пишет в Quiz.store по ходу раунда.
 *
 * Урок, оплаченный старой версией: после того как ведущий сменил вопрос,
 * НЕ рассчитывайте, что каналы buzz и participant догонят сами. Это
 * отдельные подписки, они могут отстать от строки game, и тогда подсветка
 * «отвечает» и бейджи с песочными часами залипают. Перечитывайте
 * затронутые таблицы явно — этим занимается reloadQuestionScoped().
 *
 * События DELETE приходят с полной старой строкой только потому, что у
 * `buzz` и `participant` выставлен replica identity full (см. 001_schema).
 * С настройкой по умолчанию в payload лежал бы один первичный ключ, и
 * серверный фильтр по game_id не совпал бы вовсе.
 */
Quiz.realtime = {
    channel: null,

    /** Ставится из main.js: чем перерисовывать после каждого изменения. */
    onChange: function () {},

    subscribe: function (gameId) {
        var self = this;
        var forThisGame = 'game_id=eq.' + gameId;

        this.unsubscribe();
        this.channel = Quiz.db.client.channel('quiz-' + gameId);

        this.channel
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'game', filter: 'id=eq.' + gameId },
                function (payload) { self.handleGame(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'participant', filter: forThisGame },
                function (payload) { self.handleParticipant(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'buzz', filter: forThisGame },
                function (payload) { self.handleBuzz(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'answer_log', filter: forThisGame },
                function (payload) { self.handleAnswerLog(payload); })
            .on('broadcast', { event: 'intro' },
                function () { Quiz.audio.play(Quiz.config.INTRO_SOUND); })
            .subscribe(function (status) {
                console.log('realtime:', status);
            });

        return this.channel;
    },

    unsubscribe: function () {
        if (this.channel) {
            Quiz.db.client.removeChannel(this.channel);
            this.channel = null;
        }
    },

    /** Интро играет у всех сразу — своё воспроизведение ведущий запускает сам. */
    sendIntro: function () {
        if (!this.channel) return;
        this.channel.send({ type: 'broadcast', event: 'intro', payload: {} });
    },

    // --- Обработчики -----------------------------------------------------

    handleGame: async function (payload) {
        var previous = Quiz.store.game;
        var next = payload.new;

        Quiz.store.game = next;
        Quiz.timing.applyGameRow(next);

        var questionChanged = !previous ||
            previous.current_question_id !== next.current_question_id;
        var revealChanged = !previous ||
            previous.show_answer !== next.show_answer;

        if (questionChanged) {
            // Вот та самая явная перечитка. Подписки на buzz и participant
            // придут своим темпом, а до тех пор состояние в памяти описывает
            // предыдущий вопрос.
            await this.reloadQuestionScoped();
        } else if (revealChanged) {
            await this.reloadRevealedAnswer();
        }

        this.onChange();
    },

    handleParticipant: function (payload) {
        var list = Quiz.store.participants;

        if (payload.eventType === 'DELETE') {
            Quiz.store.participants = list.filter(function (p) {
                return p.id !== payload.old.id;
            });
        } else {
            Quiz.store.participants = this.upsert(list, payload.new);
        }
        this.onChange();
    },

    handleBuzz: function (payload) {
        if (payload.eventType === 'DELETE') {
            Quiz.store.buzz = null;
        } else {
            Quiz.store.buzz = payload.new;
            this.playJingleFor(payload.new.participant_id);
        }
        this.onChange();
    },

    handleAnswerLog: function (payload) {
        var list = Quiz.store.answerLog;

        if (payload.eventType === 'DELETE') {
            Quiz.store.answerLog = list.filter(function (a) {
                return a.id !== payload.old.id;
            });
        } else if (payload.new.question_id === (Quiz.store.game || {}).current_question_id) {
            Quiz.store.answerLog = this.upsert(list, payload.new);
        }
        this.onChange();
    },

    // --- Перечитки -------------------------------------------------------

    /** Всё, что привязано к конкретному вопросу и не переживает его смены. */
    reloadQuestionScoped: async function () {
        var game = Quiz.store.game;
        if (!game) return;

        Quiz.store.buzz = await Quiz.db.getCurrentBuzz(game.id);
        Quiz.store.participants = await Quiz.db.getParticipants(game.id);

        if (game.current_question_id) {
            Quiz.store.answerLog = await Quiz.db.getAnswerLog(game.current_question_id);
        } else {
            Quiz.store.answerLog = [];
        }
        await this.reloadRevealedAnswer();
    },

    reloadRevealedAnswer: async function () {
        var game = Quiz.store.game;
        if (!game || !game.current_question_id) {
            Quiz.store.revealedAnswer = null;
            return;
        }
        Quiz.store.revealedAnswer =
            await Quiz.db.getRevealedAnswer(game.current_question_id);
    },

    // --- Мелочи ----------------------------------------------------------

    /** Заменяет строку с тем же id или дописывает новую. */
    upsert: function (list, row) {
        var replaced = false;
        var next = list.map(function (item) {
            if (item.id !== row.id) return item;
            replaced = true;
            return row;
        });
        if (!replaced) next.push(row);
        return next;
    },

    playJingleFor: function (participantId) {
        var participant = Quiz.store.participants.find(function (p) {
            return p.id === participantId;
        });
        Quiz.audio.play(participant && participant.sound_key);
    }
};
