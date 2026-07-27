/**
 * Thin DOM helpers.
 *
 * Deliberately small: this is not a framework layer, just the handful of
 * calls that would otherwise be repeated in every ui/ file.
 */
Quiz.dom = {
    /** Element by id. Throws loudly rather than returning null. */
    el: function (id) {
        var node = document.getElementById(id);
        if (!node) {
            throw new Error('DOM element not found: #' + id);
        }
        return node;
    },

    on: function (id, event, handler) {
        this.el(id).addEventListener(event, handler);
    },

    setText: function (id, text) {
        this.el(id).textContent = text == null ? '' : String(text);
    },

    /** Shows the element with `src`, hides it when `src` is empty. */
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
     * Drives the `admin-only` / `player-only` CSS rules and the whole
     * player layout, which keys off `body.role-player`.
     */
    setRole: function (role) {
        var body = document.body;
        body.classList.remove('role-unknown', 'role-admin', 'role-player');
        body.classList.add('role-' + role);
    }
};
