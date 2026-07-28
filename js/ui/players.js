/**
 * Список игроков — табло для игрока, панель управления для ведущего.
 *
 * Три вещи, которые важно не испортить:
 *
 *  - Строить строки через createElement/textContent, а не склейкой HTML.
 *    Имена игроков — пользовательский ввод; старая версия подставляла их
 *    в шаблонную строку, и кавычка в имени ломала разметку.
 *  - Игрок видит список отсортированным по очкам, ведущий — по имени.
 *    Список, который переставляется сам посреди раунда, невозможно
 *    использовать для выставления баллов.
 *  - Разметка карточки одна на обе роли: имя и «хвост» справа. Кнопки
 *    ведущего просто переносятся на вторую строку (flex-wrap в admin.css),
 *    так что вёрстка телефона от них не зависит вовсе.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.players = {
    /** Интервал, который перерисовывает бейджи ожидания. */
    tickTimer: null,

    render: function () {
        var self = this;
        var list = Quiz.dom.el('players-list');
        var rows = this.sorted(Quiz.store.participants);

        list.textContent = '';
        rows.forEach(function (participant) {
            list.appendChild(self.card(participant));
        });

        // Ожидание идёт по оси T и меняется само по себе, без единого
        // события. Гоняет цифры отдельный тик — см. startTicking.
        if (Quiz.store.isAdmin() && rows.length) {
            this.startTicking();
        } else {
            this.stopTicking();
        }
    },

    /**
     * Ведущему — по имени, игроку — по очкам.
     *
     * Порядок обязан быть полным: при равном счёте добавляется имя, иначе
     * карточки перепрыгивают местами при каждой перерисовке.
     */
    sorted: function (participants) {
        var byName = function (a, b) {
            return a.display_name.localeCompare(b.display_name, 'ru');
        };
        if (Quiz.store.isAdmin()) {
            return participants.slice().sort(byName);
        }
        return participants.slice().sort(function (a, b) {
            return (b.score - a.score) || byName(a, b);
        });
    },

    card: function (participant) {
        var isAdmin = Quiz.store.isAdmin();

        var card = document.createElement('div');
        card.className = 'player-card';
        // По нему тик находит карточку, не перестраивая список заново.
        card.dataset.participantId = participant.id;

        var buzz = Quiz.store.buzz;
        var isAnswering = !!buzz && buzz.participant_id === participant.id;
        if (isAnswering) {
            card.classList.add('is-answering');
        }

        var name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = participant.display_name;
        card.appendChild(name);

        // Хвост справа: бейджи ведущего и счёт. У игрока в нём только счёт,
        // поэтому его карточка выглядит ровно так же, как и раньше.
        var meta = document.createElement('span');
        meta.className = 'player-meta';

        if (isAdmin) {
            meta.appendChild(this.triesBadge(participant));
            meta.appendChild(this.waitBadge(participant));
        }

        var score = document.createElement('span');
        score.className = 'player-score';
        score.textContent = String(participant.score);
        meta.appendChild(score);
        card.appendChild(meta);

        if (isAdmin) {
            card.appendChild(this.actions(participant, isAnswering));
        }
        return card;
    },

    /** Сколько раз игрок уже отвечал на этот вопрос. */
    triesBadge: function (participant) {
        var badge = document.createElement('span');
        badge.className = 'badge badge-tries';
        var count = Quiz.store.answerCountFor(participant.id);
        badge.textContent = count ? '✱' + count : '';
        badge.hidden = !count;
        return badge;
    },

    /** Остаток ожидания. Текст обновляет тик, а не перерисовка списка. */
    waitBadge: function (participant) {
        var badge = document.createElement('span');
        badge.className = 'badge badge-wait';
        this.fillWait(badge, participant);
        return badge;
    },

    fillWait: function (badge, participant) {
        var ms = Quiz.timing.remainingFor(participant);
        badge.textContent = ms > 0 ? (ms / 1000).toFixed(1) : '';
        badge.hidden = ms <= 0;
    },

    /**
     * Кнопки ведущего. Обработчик замыкает id участника — делегирование
     * тут только добавило бы разбор события ради тех же трёх кнопок.
     */
    actions: function (participant, isAnswering) {
        var box = document.createElement('div');
        box.className = 'player-actions';

        box.appendChild(this.button('−1', 'Ответ неверный', function () {
            Quiz.game.score(participant.id, -1);
        }, 'is-minus'));
        box.appendChild(this.button('0', 'Отвечал, но без баллов', function () {
            Quiz.game.score(participant.id, 0);
        }));
        box.appendChild(this.button('+1', 'Ответ аргументированный', function () {
            Quiz.game.score(participant.id, 1);
        }, 'is-plus'));
        // Обе эти кнопки — только у того, кто держит буззер. «+2» закрывает
        // вопрос вместе с показом ответа, а закрывать его молчащим игроком
        // не за что; освобождать буззер тоже больше не у кого. В каждой
        // строке они бы только путались с оценкой.
        if (isAnswering) {
            // Два балла и сразу ответ на экран: этим вопрос и заканчивается,
            // поэтому открывать его отдельным нажатием в шапке уже незачем.
            box.appendChild(this.button('+2', 'Ответ верный', function () {
                Quiz.game.scoreAndToggleAnswer(participant.id, 2);
            }, 'is-plus'));
            // Подпись — значок: рядом стоят «+1» и «+2», и слово среди них
            // читалось как третья оценка. Что он делает, говорит title.
            box.appendChild(this.button('⏱', 'Освободить буззер без оценки', function () {
                Quiz.game.releaseBuzz();
            }));
        }

        box.appendChild(this.button('✕', 'Удалить из игры', function () {
            if (window.confirm('Удалить ' + participant.display_name + ' из игры?')) {
                Quiz.game.removeParticipant(participant.id);
            }
        }, 'is-danger'));

        return box;
    },

    button: function (label, title, handler, extraClass) {
        var btn = document.createElement('button');
        btn.className = 'btn-mini' + (extraClass ? ' ' + extraClass : '');
        btn.type = 'button';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', handler);
        return btn;
    },

    // --- Тик ожидания ----------------------------------------------------

    /**
     * Перерисовывать весь список пять раз в секунду нельзя: узел под
     * курсором заменится между нажатием и отпусканием, и клик по кнопке
     * оценки не состоится. Поэтому тик правит только текст бейджа в уже
     * готовых карточках — и, как и обратный отсчёт на буззере, не делает
     * при этом ни одного запроса.
     */
    startTicking: function () {
        var self = this;
        if (this.tickTimer) return;
        this.tickTimer = setInterval(function () {
            self.tick();
        }, Quiz.config.COUNTDOWN_TICK_MS);
    },

    stopTicking: function () {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    },

    tick: function () {
        var self = this;
        var cards = Quiz.dom.el('players-list').children;

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var badge = card.querySelector('.badge-wait');
            if (!badge) continue;

            var id = card.dataset.participantId;
            var participant = Quiz.store.participants.find(function (p) {
                return p.id === id;
            });
            if (participant) self.fillWait(badge, participant);
        }
    }
};
