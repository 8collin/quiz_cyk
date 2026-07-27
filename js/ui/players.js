/**
 * Список игроков — табло для игрока, панель управления для ведущего.
 *
 * Две вещи, которые важно не испортить:
 *
 *  - Строить строки через createElement/textContent, а не склейкой HTML.
 *    Имена игроков — пользовательский ввод; старая версия подставляла их
 *    в шаблонную строку, и кавычка в имени ломала разметку.
 *  - Игрок видит список отсортированным по очкам, ведущий — по имени.
 *    Список, который переставляется сам посреди раунда, невозможно
 *    использовать для выставления баллов.
 *
 * TODO(этап 4): элементы управления в строке у ведущего (−1 / 0 / +1,
 * снять ожидание, удалить) и бейдж с остатком ожидания.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.players = {
    render: function () {
        var self = this;
        var list = Quiz.dom.el('players-list');
        var rows = this.sorted(Quiz.store.participants);

        list.textContent = '';
        rows.forEach(function (participant) {
            list.appendChild(self.card(participant));
        });
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
        var card = document.createElement('div');
        card.className = 'player-card';

        var buzz = Quiz.store.buzz;
        if (buzz && buzz.participant_id === participant.id) {
            card.classList.add('is-answering');
        }

        var name = document.createElement('span');
        name.className = 'player-name';
        name.textContent = participant.display_name;

        var score = document.createElement('span');
        score.className = 'player-score';
        score.textContent = String(participant.score);

        card.appendChild(name);
        card.appendChild(score);
        return card;
    }
};
