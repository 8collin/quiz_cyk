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
    FAIL_TAKEN:       'taken',
    FAIL_WEAK:        'weak',
    FAIL_UNKNOWN:     'unknown',

    /**
     * Раскладывает ошибку Supabase на одну из причин выше.
     *
     * Отличать «не тот пароль» от «сервер недоступен» важно не из
     * вежливости: в первом случае человек пробует ещё раз, во втором ему
     * надо чинить wi-fi, и одинаковое «Ошибка входа» отправит его не туда.
     *
     * Здесь же разбираются отказы регистрации: «адрес занят» и «пароль
     * короткий» приходят только от signUp и со входом их не спутать, так
     * что второй почти такой же функции заводить незачем.
     */
    classify: function (error) {
        if (!error) return this.FAIL_UNKNOWN;

        var message = String(error.message || '');
        var code = String(error.code || '');
        var status = error.status;

        // supabase-js не бросает на сетевом сбое, а возвращает вот такое.
        if (error.name === 'AuthRetryableFetchError' || status === 0 ||
            status == null && /fetch|network/i.test(message)) {
            return this.FAIL_NETWORK;
        }
        if (code === 'user_already_exists' || /already registered/i.test(message)) {
            return this.FAIL_TAKEN;
        }
        if (code === 'weak_password' || /password should be/i.test(message)) {
            return this.FAIL_WEAK;
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

    /**
     * Вход по имени игрока (или по адресу — см. addressFor). Возвращает
     * строку profile или бросает ошибку с полем `reason`.
     */
    signIn: async function (nameOrAddress, password) {
        var result = await Quiz.db.client.auth.signInWithPassword({
            email: this.addressFor(nameOrAddress),
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

    // --- Имя вместо почты --------------------------------------------------
    //
    // В предыдущей версии игрок был строкой в quiz_users: имя кириллицей и
    // пароль. Supabase Auth логинов не знает вовсе — он умеет вход по
    // адресу и по телефону, — а своя таблица с паролями это ровно то, от
    // чего проект уходил: старая держала их открытым текстом.
    //
    // Поэтому адрес остаётся, но перестаёт быть чьим-либо делом. Он
    // собирается из имени вот здесь, одинаково при заведении и при входе, и
    // работает как внутренний идентификатор — его никто не печатает, не
    // запоминает и нигде не видит. Снаружи остаются имя и пароль, как было.
    //
    // Цена решения: имя — это и есть логин. Печатать его надо одинаково, и
    // двух «Алин» в базе не бывает — второй нужна фамилия или цифра.

    /** Кириллица в латиницу: из имени надо получить адрес, годный для Auth. */
    TRANSLIT: {
        'а': 'a',  'б': 'b', 'в': 'v',  'г': 'g',  'д': 'd',  'е': 'e',
        'ё': 'e',  'ж': 'zh', 'з': 'z', 'и': 'i',  'й': 'y',  'к': 'k',
        'л': 'l',  'м': 'm', 'н': 'n',  'о': 'o',  'п': 'p',  'р': 'r',
        'с': 's',  'т': 't', 'у': 'u',  'ф': 'f',  'х': 'h',  'ц': 'c',
        'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y',  'ь': '',
        'э': 'e',  'ю': 'yu', 'я': 'ya'
    },

    /**
     * Имя игрока → адрес, под которым его знает Supabase: «Алина» →
     * alina@quiz.local.
     *
     * Обязана быть чистой функцией от имени: тот же ввод даёт тот же адрес,
     * иначе заведённый аккаунт нельзя будет найти при входе. Отсюда же
     * приведение регистра и обрезка — «  алина » и «Алина» должны попадать
     * в один аккаунт, потому что человек считает их одним именем.
     *
     * Имя, от которого не осталось ни одной латинской буквы (скажем, одни
     * эмодзи), даёт `player@…`; занятое имя отобьёт сам Supabase, и ведущий
     * увидит про это отдельное сообщение.
     */
    loginFor: function (name) {
        var self = this;
        var slug = String(name || '')
            .toLowerCase()
            .split('')
            .map(function (ch) {
                return self.TRANSLIT[ch] !== undefined ? self.TRANSLIT[ch] : ch;
            })
            .join('')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        return (slug || 'player') + '@' + Quiz.config.ACCOUNT_DOMAIN;
    },

    /**
     * Что вписали в поле входа → адрес для Supabase.
     *
     * Собака означает, что вписан адрес целиком. Это запасная дверь, и
     * стоит она одной строки: под конвенцию не подходят три аккаунта,
     * заведённые до неё (у «Ведущего» адрес `host@quiz.local`), да и имя с
     * логином когда-нибудь может разойтись — переименование в `profile`
     * адрес не меняет. Без этой строки старые аккаунты пришлось бы
     * переименовывать прямо в `auth.users`.
     */
    addressFor: function (input) {
        var clean = String(input || '').trim();
        return clean.indexOf('@') >= 0 ? clean : this.loginFor(clean);
    },

    /** Пароль, который не стыдно продиктовать через комнату. Шесть — минимум Supabase. */
    suggestPassword: function () {
        return String(Math.floor(100000 + Math.random() * 900000));
    },

    /**
     * Заводит аккаунт игроку по имени и паролю — ровно тем двум вещам,
     * которые ведущий вводил и в предыдущей версии.
     *
     * Имя уходит в `options.data`, откуда его забирает триггер
     * handle_new_user и кладёт в profile.display_name. Отдельного шага
     * «переименовать после регистрации» больше нет.
     *
     * Участником игры новый игрок станет сам, когда войдёт: `join_game`
     * зовётся при каждом старте. Ведущему делать для этого ничего не надо.
     */
    createAccount: async function (name, password) {
        var clean = String(name || '').trim();
        var result = await Quiz.db.getSignupClient().auth.signUp({
            email: this.loginFor(clean),
            password: String(password || ''),
            options: { data: { display_name: clean } }
        });

        if (result.error) {
            throw this.fail(this.classify(result.error), result.error.message);
        }
        return { name: clean, address: this.loginFor(clean) };
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
