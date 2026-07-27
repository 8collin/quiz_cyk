/**
 * Тонкие помощники для работы с DOM.
 *
 * Намеренно маленькие: это не слой фреймворка, а те несколько вызовов,
 * которые иначе повторялись бы в каждом файле ui/.
 */
Quiz.dom = {
    /** Элемент по id. Падает громко, а не возвращает null. */
    el: function (id) {
        var node = document.getElementById(id);
        if (!node) {
            throw new Error('Элемент DOM не найден: #' + id);
        }
        return node;
    },

    on: function (id, event, handler) {
        this.el(id).addEventListener(event, handler);
    },

    setText: function (id, text) {
        this.el(id).textContent = text == null ? '' : String(text);
    },

    /** Показывает элемент с `src`, прячет, когда `src` пустой. */
    setImage: function (id, src) {
        var node = this.el(id);
        if (src) {
            node.src = src;
            node.hidden = false;
        } else {
            node.hidden = true;
            node.removeAttribute('src');
        }
    },

    toggle: function (id, visible) {
        this.el(id).hidden = !visible;
    },

    /**
     * Управляет CSS-правилами `admin-only` / `player-only` и всей вёрсткой
     * игрока, которая завязана на `body.role-player`.
     */
    setRole: function (role) {
        var body = document.body;
        body.classList.remove('role-unknown', 'role-admin', 'role-player');
        body.classList.add('role-' + role);
    }
};
