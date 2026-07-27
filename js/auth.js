/**
 * Вход и выход поверх Supabase Auth.
 *
 * Пароли этот код не видит, не хранит и не сравнивает — ради этого и был
 * оставлен старый `select * from quiz_users where login=? and password=?`,
 * который держал их открытым текстом и позволял прочитать таблицу любому,
 * у кого есть anon-ключ.
 *
 * Сессию хранит сам SDK, в localStorage, и сам обновляет токен. Поэтому
 * перезагрузка страницы не должна спрашивать пароль заново — за это
 * отвечает restoreSession().
 */
Quiz.auth = {
    /**
     * Причины отказа, которые интерфейс обязан различать. Дальше по ним
     * подбирается текст; сообщения от Supabase английские и показывать их
     * человеку нельзя.
     */
    FAIL_CREDENTIALS: 'credentials',
    FAIL_UNCONFIRMED: 'unconfirmed',
    FAIL_NETWORK:     'network',
    FAIL_NO_PROFILE:  'no_profile',
    FAIL_UNKNOWN:     'unknown',

    /**
     * Раскладывает ошибку Supabase на одну из причин выше.
     *
     * Отличать «не тот пароль» от «сервер недоступен» важно не из
     * вежливости: в первом случае человек пробует ещё раз, во втором ему
     * надо чинить wi-fi, и одинаковое «Ошибка входа» отправит его не туда.
     */
    classify: function (error) {
        if (!error) return this.FAIL_UNKNOWN;

        var message = String(error.message || '');
        var status = error.status;

        // supabase-js не бросает на сетевом сбое, а возвращает вот такое.
        if (error.name === 'AuthRetryableFetchError' || status === 0 ||
            status == null && /fetch|network/i.test(message)) {
            return this.FAIL_NETWORK;
        }
        if (/email not confirmed/i.test(message)) {
            return this.FAIL_UNCONFIRMED;
        }
        if (status === 400 || /invalid login credentials/i.test(message)) {
            return this.FAIL_CREDENTIALS;
        }
        return this.FAIL_UNKNOWN;
    },

    /** Ошибка с полем `reason` — интерфейс смотрит на него, не на текст. */
    fail: function (reason, message) {
        var err = new Error(message || reason);
        err.reason = reason;
        return err;
    },

    /**
     * Читает строку profile и кладёт её в Quiz.store.
     *
     * Профиля может не быть, если триггер handle_new_user не отработал при
     * регистрации. Молча продолжать нельзя: без роли непонятно даже, какую
     * раскладку показывать.
     */
    loadProfile: async function (userId) {
        var profile;
        try {
            profile = await Quiz.db.getProfile(userId);
        } catch (err) {
            throw this.fail(this.FAIL_NETWORK, err.message);
        }
        if (!profile) {
            throw this.fail(this.FAIL_NO_PROFILE);
        }
        Quiz.store.profile = profile;
        return profile;
    },

    /** Возвращает строку profile или бросает ошибку с полем `reason`. */
    signIn: async function (email, password) {
        var result = await Quiz.db.client.auth.signInWithPassword({
            email: String(email || '').trim(),
            password: String(password || '')
        });

        if (result.error) {
            throw this.fail(this.classify(result.error), result.error.message);
        }
        return await this.loadProfile(result.data.user.id);
    },

    /**
     * Сессия при старте страницы. Возвращает profile или null, если входа
     * не было. Пароль здесь не участвует — токен уже лежит в localStorage.
     */
    restoreSession: async function () {
        var result = await Quiz.db.client.auth.getSession();
        var session = result.data && result.data.session;
        if (!session) return null;
        return await this.loadProfile(session.user.id);
    },

    signOut: async function () {
        await Quiz.db.client.auth.signOut();
        Quiz.store.profile = null;
        Quiz.store.reset();
    },

    /**
     * Реакция на то, что сессия кончилась не по нашей воле — истёк токен,
     * выход из другой вкладки.
     *
     * SIGNED_IN здесь намеренно игнорируется: вход мы и так проводим сами
     * через signIn(), а обработка обоих путей завела бы игру дважды.
     * INITIAL_SESSION приходит сразу при подписке — им занимается
     * restoreSession(). Внутри обработчика нельзя ждать вызовы Supabase,
     * SDK на этом залипает, поэтому здесь только синхронная работа.
     */
    onSignedOut: function (callback) {
        Quiz.db.client.auth.onAuthStateChange(function (event, session) {
            if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
            if (event === 'SIGNED_OUT' || !session) {
                Quiz.store.profile = null;
                Quiz.store.reset();
                callback();
            }
        });
    }
};
