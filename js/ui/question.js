/**
 * Область вопроса и строка состояния в шапке.
 *
 * Ведущий всегда видит и вопрос, и ответ (ответ — в отдельной панели
 * ниже). Игрок видит вопрос, а ответ только после того, как ведущий его
 * открыл, — и к этому моменту строка с ответом вообще становится ему
 * доступна на чтение, а решает это RLS, не этот файл.
 *
 * Поэтому здесь нет ни одной проверки роли и ни одного обращения к
 * show_answer: панель показывается ровно тогда, когда в store лежит ответ,
 * а попал он туда или нет — уже решила база.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.question = {
    render: function () {
        var store = Quiz.store;

        if (!store.game) {
            return this.showPlaceholder('Игра не найдена');
        }
        if (!store.questions.length) {
            return this.showPlaceholder('Вопросы ещё не загружены');
        }

        var question = store.currentQuestion();
        if (!question) {
            return this.showPlaceholder('Вопрос не выбран');
        }

        Quiz.dom.setText('question-text', question.text);
        Quiz.dom.setImage('question-image', question.image_url);
        Quiz.dom.setText('status-text',
            'ВОПРОС ' + store.currentNumber() + ' / ' + store.questions.length);

        this.renderAnswer(store.revealedAnswer);
    },

    renderAnswer: function (answer) {
        Quiz.dom.toggle('answer-preview', !!answer);
        if (!answer) {
            // Чистим содержимое, а не только прячем панель: иначе прошлый
            // ответ останется в DOM и его достанут через devtools.
            Quiz.dom.setText('answer-text', '');
            Quiz.dom.setImage('answer-image', null);
            return;
        }
        Quiz.dom.setText('answer-text', answer.text);
        Quiz.dom.setImage('answer-image', answer.image_url);
    },

    showPlaceholder: function (text) {
        Quiz.dom.setText('question-text', text);
        Quiz.dom.setImage('question-image', null);
        Quiz.dom.setText('status-text', '');
        this.renderAnswer(null);
    }
};
