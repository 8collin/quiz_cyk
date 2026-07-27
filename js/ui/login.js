/**
 * Экран входа: форма, строка ошибки и передача управления в Quiz.auth.
 *
 * Тексты ошибок живут здесь, а не в Quiz.auth: тот отдаёт причину отказа
 * кодом, интерфейс переводит её на человеческий. Показывать сообщения
 * Supabase как есть нельзя — они английские и говорят о внутренностях.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.login = {
    MESSAGES: {
        credentials: 'Неверная почта или пароль',
        unconfirmed: 'Почта не подтверждена — попросите ведущего',
        network:     'Сервер не отвечает. Проверьте подключение к сети.',
        no_profile:  'Профиль не найден. Скажите ведущему — аккаунт заведён не до конца.',
        unknown:     'Не удалось войти'
    },

    /**
     * @param {function(object)} onSuccess вызывается со строкой profile.
     */
    bind: function (onSuccess) {
        var self = this;

        Quiz.dom.on('login-form', 'submit', async function (event) {
            event.preventDefault();

            var email = Quiz.dom.el('login-email').value;
            var password = Quiz.dom.el('login-password').value;

            self.setError('');
            self.setBusy(true);
            try {
                var profile = await Quiz.auth.signIn(email, password);
                // Пароль не должен пережить вход даже в поле формы.
                Quiz.dom.el('login-password').value = '';
                onSuccess(profile);
            } catch (err) {
                self.setError(self.MESSAGES[err.reason] || self.MESSAGES.unknown);
                console.warn('Вход не удался:', err.reason, err.message);
            } finally {
                self.setBusy(false);
            }
        });
    },

    show: function () {
        Quiz.dom.toggle('screen-login', true);
        Quiz.dom.toggle('screen-game', false);
        this.setError('');
        Quiz.dom.el('login-password').value = '';
    },

    hide: function () {
        Quiz.dom.toggle('screen-login', false);
        Quiz.dom.toggle('screen-game', true);
    },

    setError: function (text) {
        Quiz.dom.setText('login-error', text);
    },

    /** Гасит кнопку на время запроса, чтобы двойной тап не ушёл дважды. */
    setBusy: function (busy) {
        var button = Quiz.dom.el('login-submit');
        button.disabled = busy;
        button.textContent = busy ? 'Вход...' : 'Войти';
    }
};
