/**
 * Просмотр картинки во весь экран.
 *
 * Слой один на обе роли и на обе картинки — вопроса и ответа: показывает
 * ту, по которой нажали. Роли у него нет и быть не должно, картинку
 * разглядывают одинаково с телефона и с ноутбука ведущего.
 *
 * Закрывается крестиком, щелчком куда угодно по слою и Esc. Отдельного
 * попадания «мимо картинки» не требуем: картинка растянута на весь слой
 * (см. .lightbox-image), так что поля вокруг неё — это она же, и телефону
 * такое различие всё равно ни к чему.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.lightbox = {
    /** id картинки, которую сейчас показываем, или null, когда закрыт. */
    sourceId: null,

    bind: function () {
        var self = this;

        Quiz.dom.on('question-image', 'click', function () { self.open('question-image'); });
        Quiz.dom.on('answer-image', 'click', function () { self.open('answer-image'); });
        // Крестик отдельной строкой, хотя щелчок по слою и так закрывает:
        // его щелчок сюда же и всплывёт, а второй вызов close() ничего не
        // делает. Строка нужна, чтобы кнопка не зависела от того, остался
        // ли обработчик на слое.
        Quiz.dom.on('lightbox-close', 'click', function () { self.close(); });
        Quiz.dom.on('lightbox', 'click', function () { self.close(); });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                self.close();
            }
        });

        // Слой копирует высоту строки с кнопкой (см. fit()), а она меняется
        // и от поворота телефона, и от перехода на двухколоночную раскладку.
        // Наблюдаем прямо за строкой, а не за окном: тогда пересчитывать
        // нечего — событие приходит ровно тогда, когда меняется то самое
        // число, которое мы копируем.
        new ResizeObserver(function () { self.fit(); })
            .observe(document.querySelector('.action-area'));
    },

    open: function (id) {
        var source = Quiz.dom.el(id);
        // Картинки у вопроса может не быть вовсе: тогда элемент спрятан и
        // src с него снят, а клику взяться неоткуда. Проверка на случай
        // вызова не из обработчика.
        if (!source.getAttribute('src')) return;

        this.sourceId = id;
        Quiz.dom.el('lightbox-image').src = source.src;
        Quiz.dom.toggle('lightbox', true);
        this.fit();
    },

    close: function () {
        if (!this.sourceId) return;
        this.sourceId = null;
        Quiz.dom.toggle('lightbox', false);
        Quiz.dom.el('lightbox-image').removeAttribute('src');
    },

    /**
     * Нижний край слоя. Он заканчивается над кнопкой буззера, а не
     * накрывает её: иначе игрок, засмотревшийся на картинку, терял бы на
     * закрытие ту самую секунду, в которую и жмут.
     *
     * Высота берётся у самой строки с кнопкой, а не вписана числом: на
     * телефоне и на широком экране она разная, а у ведущего этой строки
     * нет вовсе — и тогда это ноль, что и требуется.
     */
    fit: function () {
        if (!this.sourceId) return;
        var action = document.querySelector('.action-area');
        var height = action ? action.getBoundingClientRect().height : 0;
        Quiz.dom.el('lightbox').style.bottom = height + 'px';
    },

    /**
     * Картинка могла смениться, пока её разглядывали: ведущий листает
     * вопросы, и подписка приносит новую. Держать открытой прошлую нельзя
     * — в худшем случае это ответ, который уже закрыли обратно.
     */
    render: function () {
        if (!this.sourceId) return;

        var source = Quiz.dom.el(this.sourceId);
        if (source.hidden || source.src !== Quiz.dom.el('lightbox-image').src) {
            this.close();
        }
    }
};
