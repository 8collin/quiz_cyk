/**
 * Панель пользователей — только у ведущего.
 *
 * Здесь четыре дела: завести аккаунт, переименовать человека, выдать ему
 * новый пароль и удалить аккаунт совсем.
 *
 * Устроена как панель звуков и по тем же причинам: открыта она или нет —
 * дело только этого устройства, поэтому флага в базе у неё нет, в отличие
 * от статистики, и игроки о ней не знают вовсе.
 *
 * Имя и логин здесь — разные вещи, и это главное, что стоит знать. Логин
 * (`profile.login`) — зеркало адреса из auth.users, им человек входит, и
 * панель его только показывает. Имя (`profile.display_name`) видно на
 * табло, оно принадлежит человеку, а не игре, и меняется свободно: копии
 * в participant по всем играм подтянет триггер. Почему так — в шапке
 * sql/006_users.sql.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.users = {
    /** Открыта ли панель. Живёт только в памяти вкладки. */
    open: false,

    /**
     * Тексты отказов при заведении аккаунта. Причину кодом отдаёт
     * Quiz.auth, переводит её на человеческий интерфейс — как и на экране
     * входа.
     */
    ACCOUNT_MESSAGES: {
        taken:   'Игрок с таким именем уже есть. Имя — это и есть вход, поэтому второму нужна фамилия или цифра.',
        weak:    'Пароль должен быть хотя бы в два знака.',
        network: 'Не получилось связаться с сервером. Проверьте подключение.',
        // Аккаунт при этом заведён и в списке уже есть — отсюда и
        // формулировка: не «не вышло», а «доделайте вот этим».
        password_left: 'Аккаунт заведён, но пароль на нём остался временный и никому не известен. ' +
                       'Задайте его кнопкой «Пароль» в строке игрока.',
        unknown: 'Не удалось завести аккаунт'
    },

    bind: function () {
        var self = this;
        Quiz.dom.on('btn-toggle-users', 'click', function () { self.toggle(); });
        Quiz.dom.on('btn-users-close', 'click', function () { self.toggle(); });
        Quiz.dom.on('btn-add-account', 'click', function () { self.createAccount(); });
    },

    toggle: function () {
        this.open = !this.open;
        // Панель звуков стоит в разметке выше и потому накрыла бы эту:
        // старшинство панелей задаёт их порядок, см. admin.css. Пока их
        // было две — одна с флагом в базе, другая нет, — это ничем не
        // мешало; с двумя местными панель просто не открывалась бы.
        if (this.open && Quiz.ui.sounds.open) {
            Quiz.ui.sounds.open = false;
            Quiz.ui.sounds.render();
        }
        this.render();
        // Список читаем после отрисовки: панель обязана открыться сразу, а
        // не после круговой поездки в базу.
        if (this.open) this.reload();
    },

    /**
     * Перечитать список.
     *
     * Своей подпиской он не обновляется: `profile` в публикации realtime
     * нет, и заводить её ради панели, которую открывают раз в игру, было
     * бы дороже, чем перечитать. Все правки идут отсюда же, так что
     * перечитка следом за каждой держит список верным.
     */
    reload: async function () {
        try {
            Quiz.store.users = await Quiz.db.getUsers();
        } catch (err) {
            console.warn('Список пользователей не прочитан:', err.message);
            return;
        }
        this.render();
    },

    // --- Действия ---------------------------------------------------------

    /**
     * Аккаунт игроку — имя и пароль, как в предыдущей версии.
     *
     * Адрес здесь не спрашивается: он собирается из имени и остаётся
     * внутренним делом Supabase. Дальше имя можно менять сколько угодно, а
     * адрес останется тем, с которым аккаунт заведён, — панель показывает
     * его в строке, чтобы это не оказалось сюрпризом.
     *
     * Пароль предлагается шестизначный и его можно переписать: диктовать
     * через комнату проще число, но выбор за ведущим. Дальше пароль живёт
     * только в этих двух диалогах — в игру он не попадает и никуда не
     * сохраняется, проверять его будет Supabase, а не мы.
     */
    createAccount: async function () {
        var name = (window.prompt('Имя игрока — оно же вход:') || '').trim();
        if (!name) return;

        var password = window.prompt(
            'Пароль для «' + name + '»:',
            Quiz.auth.suggestPassword()
        );
        if (!password) return;

        try {
            var account = await Quiz.auth.createAccount(name, password);
            console.log('Аккаунт заведён:', account.name, '→', account.address);
            window.alert(
                'Аккаунт готов — продиктуйте игроку:\n\n' +
                'Имя:    ' + name + '\n' +
                'Пароль: ' + password + '\n\n' +
                'В игру он попадёт сам, как только войдёт.'
            );
        } catch (err) {
            window.alert(this.ACCOUNT_MESSAGES[err.reason] || this.ACCOUNT_MESSAGES.unknown);
            // warn, а не error: разобранный отказ, показанный человеку, —
            // это не сбой приложения. Так же поступают вход и импорт.
            console.warn('Аккаунт не заведён:', err.reason, err.message);
        }
        // Перечитываем в любом случае: часть отказов оставляет аккаунт
        // заведённым (password_left), и он обязан появиться в списке — им
        // же ведущий и будет доделывать.
        await this.reload();
    },

    /**
     * Переименование.
     *
     * Меняется строка profile, и этого достаточно: имена на табло и в
     * статистике — копии, которые триггер подтянет сам, а до телефонов их
     * довезёт подписка на participant.
     *
     * Вход при этом не меняется, и об этом сказано в самом диалоге:
     * логин у аккаунта один навсегда, а имя с ним после первого же
     * переименования расходится.
     */
    rename: async function (user) {
        var name = window.prompt(
            'Новое имя. Вход останется прежним — «' + this.loginOf(user) + '»:',
            user.display_name
        );
        if (name === null) return;

        name = name.trim();
        if (!name || name === user.display_name) return;

        try {
            await Quiz.db.setUserName(user.id, name);
            await this.reload();
        } catch (err) {
            window.alert('Не удалось переименовать: ' + err.message);
            console.warn('Переименование не прошло:', err.message);
        }
    },

    /**
     * Новый пароль.
     *
     * Уходит в базу открытым текстом параметром функции — она же его и
     * хеширует. Это единственный оставшийся путь: сменить пароль другому
     * человеку умеет только admin API, а он требует ключ service_role,
     * которому в этом репозитории быть нельзя. Подробности и цена — в
     * шапке admin_set_password, sql/006_users.sql.
     */
    setPassword: async function (user) {
        var password = window.prompt(
            'Новый пароль для «' + user.display_name + '»:',
            Quiz.auth.suggestPassword()
        );
        if (!password) return;

        try {
            await Quiz.db.setUserPassword(user.id, password);
            window.alert(
                'Пароль сменён — продиктуйте игроку:\n\n' +
                'Имя:    ' + this.loginOf(user) + '\n' +
                'Пароль: ' + password + '\n\n' +
                'Тот, кто уже вошёл, останется в игре до конца сессии.'
            );
        } catch (err) {
            window.alert('Не удалось сменить пароль: ' + err.message);
            console.warn('Пароль не сменён:', err.message);
        }
    },

    /**
     * Удаление аккаунта.
     *
     * Строка на табло его переживает — вместе со счётом и историей, — и в
     * подтверждении об этом сказано прямо: иначе «удалить» читалось бы как
     * «стереть из статистики», а это разные вещи.
     */
    remove: async function (user) {
        var ok = window.confirm(
            'Удалить аккаунт «' + user.display_name + '»?\n\n' +
            'Войти под ним больше не получится. Счёт и результаты в уже ' +
            'сыгранных играх останутся на месте.'
        );
        if (!ok) return;

        try {
            await Quiz.db.deleteUser(user.id);
            await this.reload();
        } catch (err) {
            window.alert('Не удалось удалить: ' + err.message);
            console.warn('Аккаунт не удалён:', err.message);
        }
    },

    // --- Отрисовка --------------------------------------------------------

    render: function () {
        if (!Quiz.store.isAdmin()) return;
        Quiz.dom.toggle('users-view', this.open);
        Quiz.dom.el('btn-toggle-users').classList.toggle('is-on', this.open);
        if (!this.open) return;

        this.renderList();
    },

    renderList: function () {
        var self = this;
        var box = Quiz.dom.el('users-list');
        box.textContent = '';

        if (!Quiz.store.users.length) {
            box.appendChild(this.note('Аккаунтов пока нет — заведите первый.'));
            return;
        }
        Quiz.store.users.forEach(function (user) {
            box.appendChild(self.userRow(user));
        });
    },

    /** «valera@quiz.local» → «valera»: диктовать всё равно эту половину. */
    loginOf: function (user) {
        var login = user.login || '';
        var at = login.indexOf('@');
        return at > 0 ? login.slice(0, at) : login;
    },

    userRow: function (user) {
        var self = this;
        var isMe = !!Quiz.store.profile && Quiz.store.profile.id === user.id;

        var row = document.createElement('div');
        row.className = 'user-row' + (user.role === 'admin' ? ' is-host' : '');

        var name = document.createElement('span');
        name.className = 'user-name';
        name.textContent = user.display_name;
        row.appendChild(name);

        // Логин виден всегда, а не по наведению: после первого же
        // переименования имя перестаёт быть тем, что человек набирает в
        // поле входа, и догадаться об этом больше неоткуда.
        var login = document.createElement('span');
        login.className = 'user-login';
        login.textContent = user.login || '— без адреса —';
        login.title = 'Вход. Не меняется и переименованием не задевается.';
        row.appendChild(login);

        row.appendChild(this.button('Имя', 'Переименовать', function () {
            self.rename(user);
        }));
        row.appendChild(this.button('Пароль', 'Выдать новый пароль', function () {
            self.setPassword(user);
        }));

        // Себя ведущий не удаляет. Функция это тоже не пропустит, но
        // кнопка, которая всегда отвечает отказом, — это не защита, а
        // ловушка.
        if (!isMe) {
            row.appendChild(this.button('✕', 'Удалить аккаунт', function () {
                self.remove(user);
            }, 'is-danger'));
        }
        return row;
    },

    note: function (text) {
        var node = document.createElement('div');
        node.className = 'sound-note';
        node.textContent = text;
        return node;
    },

    button: function (label, title, handler, extraClass) {
        var btn = document.createElement('button');
        btn.className = 'btn-mini' + (extraClass ? ' ' + extraClass : '');
        btn.type = 'button';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', handler);
        return btn;
    }
};
