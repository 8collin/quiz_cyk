/**
 * Панель звуков — только у ведущего.
 *
 * Здесь три дела: залить или заменить файл, свести громкость каждого
 * звука и раздать звуки игрокам. Всё это можно делать посреди игры:
 * `sound` и `participant` лежат в публикации realtime, так что правка
 * доезжает до телефонов сама, без перезагрузки.
 *
 * Открыта панель или нет — дело только этого устройства, поэтому флага в
 * базе у неё нет, в отличие от статистики. Игроки о ней не знают вовсе.
 *
 * Кнопка «▶» проигрывает звук ЗДЕСЬ, на ноутбуке ведущего, и с уже
 * применённым микшером — чтобы свести громкости, слушая результат.
 * Разослать звук на все устройства умеет только «🎵» в шапке.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.sounds = {
    /** Открыта ли панель. Живёт только в памяти вкладки. */
    open: false,

    /**
     * Звук, которому меняют файл, или null, когда файл заливают новым
     * звуком. Поле нужно потому, что `<input type="file">` на всю панель
     * один: заводить по скрытому полю на строку значило бы держать в DOM
     * два десятка одинаковых элементов.
     */
    replacing: null,

    MESSAGES: {
        exists:  'Звук с таким ключом уже есть. Чтобы заменить файл, нажмите «Файл» в его строке.',
        format:  'Это не похоже на звуковой файл. Нужен .mp3, .ogg, .wav или .m4a.',
        upload:  'Не удалось залить файл',
        unknown: 'Не получилось'
    },

    EXTENSIONS: ['.mp3', '.ogg', '.wav', '.m4a'],

    bind: function () {
        var self = this;
        Quiz.dom.on('btn-toggle-sounds', 'click', function () { self.toggle(); });

        Quiz.dom.on('input-sound', 'change', function (event) {
            var input = event.target;
            var file = input.files[0];
            // Сброс сразу: иначе повторный выбор того же файла не даст
            // события, и «залить ещё раз» после ошибки не сработает.
            input.value = '';
            if (file) self.acceptFile(file);
        });
    },

    toggle: function () {
        this.open = !this.open;
        // Эта панель стоит в разметке выше панели пользователей и накрыла
        // бы её (старшинство задаёт порядок, см. admin.css). Открытая
        // «под» ничего не показывает, поэтому закрываем её сами.
        if (this.open && Quiz.ui.users.open) {
            Quiz.ui.users.open = false;
            Quiz.ui.users.render();
        }
        this.render();
        // Джинглы раздаём по аккаунтам, а не по участникам игры, поэтому
        // список людей — это профили. В публикации realtime их нет (см.
        // users.js), так что читаем при открытии — панель уже показана, а
        // список дозагрузится, как и в панели пользователей.
        if (this.open) this.loadUsers();
    },

    /**
     * Дочитать список аккаунтов — из него строится раздача джинглов.
     *
     * `profile` в публикацию realtime не входит, подпиской он не освежается;
     * читаем при каждом открытии. Список общий с панелью пользователей
     * (Quiz.store.users), и обе держат его свежим одинаково.
     */
    loadUsers: async function () {
        try {
            Quiz.store.users = await Quiz.db.getUsers();
        } catch (err) {
            console.warn('Список аккаунтов не прочитан:', err.message);
            return;
        }
        this.render();
    },

    // --- Заливка ----------------------------------------------------------

    looksLikeSound: function (name) {
        var lower = String(name || '').toLowerCase();
        return this.EXTENSIONS.some(function (ext) {
            return lower.slice(-ext.length) === ext;
        });
    },

    /** 'Алина.mp3' -> '.mp3'; для имени без точки — пусто. */
    extensionOf: function (name) {
        var dot = String(name).lastIndexOf('.');
        return dot > 0 ? String(name).slice(dot).toLowerCase() : '';
    },

    /**
     * Имя объекта в бакете. Каждый раз новое, и не из ключа звука.
     *
     * Из ключа нельзя: Storage не принимает в имени объекта ничего, кроме
     * узкого набора ASCII, а ключи здесь — это имена игроков, то есть
     * почти всегда кириллица. Заливка «Алина.mp3» отвергается с
     * «Invalid key», и это ровно то, обо что споткнулся переезд.
     *
     * Каждый раз новое — чтобы замена файла была слышна сразу. Бакет
     * публичный, объекты отдаются с заголовком кеширования; положи новый
     * файл на прежний путь — и адрес не изменится, а браузеры и CDN ещё
     * час будут отдавать старый звук.
     *
     * crypto.randomUUID есть не везде (нужен защищённый контекст), а
     * страница обязана работать и открытой с диска, поэтому есть запасной
     * путь. Уникальности «время + случайное» для имени файла достаточно.
     */
    freshPath: function (fileName) {
        var id = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        return id + this.extensionOf(fileName);
    },

    /** 'Алина.mp3' -> 'Алина' */
    stemOf: function (name) {
        var dot = String(name).lastIndexOf('.');
        return dot > 0 ? String(name).slice(0, dot) : String(name);
    },

    acceptFile: async function (file) {
        if (!this.looksLikeSound(file.name)) {
            window.alert(this.MESSAGES.format);
            return;
        }

        var target = this.replacing;
        this.replacing = null;

        try {
            if (target) {
                // Замена файла у существующего звука. Старый убираем
                // только после того, как новый лёг и строка на него
                // показывает: между двумя запросами игра не должна
                // остаться со ссылкой в никуда.
                var freshPath = this.freshPath(file.name);
                await Quiz.db.uploadSound(freshPath, file);
                await Quiz.db.saveSound({
                    key: target.key,
                    title: target.title,
                    path: freshPath,
                    isSystem: target.is_system
                });
                if (target.path) {
                    await Quiz.db.deleteSoundFile(target.path);
                }
            } else {
                var key = (window.prompt('Ключ звука — им он и адресуется:',
                                         this.stemOf(file.name)) || '').trim();
                if (!key) return;
                if (Quiz.store.soundFor(key)) {
                    window.alert(this.MESSAGES.exists);
                    return;
                }
                var path = this.freshPath(file.name);
                await Quiz.db.uploadSound(path, file);
                await Quiz.db.saveSound({ key: key, title: key, path: path });
            }
            await this.reload();
        } catch (err) {
            window.alert(this.MESSAGES.upload + ': ' + err.message);
            console.warn('Звук не залит:', err.message);
        }
    },

    /**
     * Перечитать список.
     *
     * Своя правка вернулась бы и подпиской, но ждать её здесь нельзя:
     * заливка идёт в Storage, а строку меняет отдельный запрос, и панель
     * должна показать результат сразу, как только оба прошли.
     */
    reload: async function () {
        Quiz.store.sounds = await Quiz.db.getSounds();
        Quiz.audio.warmUp();
        this.render();
    },

    // --- Отрисовка --------------------------------------------------------

    render: function () {
        if (!Quiz.store.isAdmin()) return;
        Quiz.dom.toggle('sounds-view', this.open);
        Quiz.dom.el('btn-toggle-sounds').classList.toggle('is-on', this.open);
        if (!this.open) return;

        this.renderSounds();
        this.renderAssignments();
    },

    renderSounds: function () {
        var self = this;
        var box = Quiz.dom.el('sounds-list');
        box.textContent = '';

        if (!Quiz.store.sounds.length) {
            box.appendChild(this.note('Звуков пока нет — залейте первый.'));
            return;
        }

        // Системные (default, intro) — сверху, остальные по ключу. Между
        // ними разделитель: перед первым несистемным и только если
        // системные вообще есть.
        var sorted = Quiz.store.sounds.slice().sort(function (a, b) {
            var sa = a.is_system ? 0 : 1;
            var sb = b.is_system ? 0 : 1;
            return (sa - sb) || String(a.key).localeCompare(String(b.key), 'ru');
        });

        var sawSystem = false, sepDone = false;
        sorted.forEach(function (sound) {
            if (sound.is_system) {
                sawSystem = true;
            } else if (sawSystem && !sepDone) {
                box.appendChild(self.separator());
                sepDone = true;
            }
            box.appendChild(self.soundRow(sound));
        });
    },

    soundRow: function (sound) {
        var self = this;
        var row = document.createElement('div');
        row.className = 'sound-row' + (sound.is_system ? ' is-system' : '');

        var name = document.createElement('span');
        name.className = 'sound-key';
        name.textContent = sound.key;
        name.title = sound.is_system
            ? 'Системный звук: ключ менять нельзя, удалить тоже'
            : sound.path;
        row.appendChild(name);

        // Ползунок правит громкость на слух, поэтому пишем в базу по
        // отпусканию (change), а не на каждое движение (input): иначе
        // одно перетаскивание — это десятки запросов.
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'sound-slider';
        slider.min = 0;
        slider.max = 100;
        slider.value = String(Math.round(Number(sound.volume) * 100));

        var percent = document.createElement('span');
        percent.className = 'sound-percent';
        percent.textContent = slider.value + '%';

        slider.addEventListener('input', function () {
            percent.textContent = slider.value + '%';
        });
        slider.addEventListener('change', function () {
            Quiz.db.setSoundVolume(sound.id, Number(slider.value) / 100)
                .catch(function (err) {
                    console.warn('Громкость не сохранилась:', err.message);
                });
        });
        row.appendChild(slider);
        row.appendChild(percent);

        row.appendChild(this.button('▶', 'Прослушать здесь, с этой громкостью', function () {
            // Играем то, что в ползунке, не дожидаясь ответа базы: сводят
            // на слух, и пауза на круговой поход тут всё портит.
            var pending = Object.assign({}, sound, { volume: Number(slider.value) / 100 });
            Quiz.store.sounds = Quiz.store.sounds.map(function (s) {
                return s.id === sound.id ? pending : s;
            });
            Quiz.audio.play(sound.key, false);
        }));

        row.appendChild(this.button('Файл', 'Заменить файл этого звука', function () {
            self.replacing = sound;
            Quiz.dom.el('input-sound').click();
        }));

        // Кнопка удаления есть у каждой строки — ради ровной разметки, — но
        // у системных (default, intro) выключена: без них игре нечем
        // заменить пропавший джингл.
        var canDelete = !sound.is_system;
        var del = this.button('✕', canDelete ? 'Удалить звук' : 'Системный звук удалить нельзя',
            function () { if (canDelete) self.remove(sound); }, 'is-danger');
        del.disabled = !canDelete;
        row.appendChild(del);
        return row;
    },

    remove: async function (sound) {
        var assigned = Quiz.store.users.filter(function (u) {
            return u.sound_key === sound.key;
        });
        var warning = assigned.length
            ? '\n\nОн назначен: ' +
              assigned.map(function (u) { return u.display_name; }).join(', ') +
              '. Им заиграет звук по умолчанию.'
            : '';
        if (!window.confirm('Удалить звук «' + sound.key + '»?' + warning)) return;

        try {
            await Quiz.db.deleteSound(sound.id);
            await Quiz.db.deleteSoundFile(sound.path);
            await this.reload();
        } catch (err) {
            window.alert(this.MESSAGES.unknown + ': ' + err.message);
            console.warn('Звук не удалён:', err.message);
        }
    },

    /**
     * Кому какой джингл. Список — все аккаунты: джингл теперь свойство
     * человека, а не игры, так что назначить его можно и тому, кого сейчас
     * в игре нет. Профили держит Quiz.store.users, дочитанный при открытии.
     */
    renderAssignments: function () {
        var self = this;
        var box = Quiz.dom.el('sounds-players');
        box.textContent = '';

        var users = Quiz.store.users.slice().sort(function (a, b) {
            return a.display_name.localeCompare(b.display_name, 'ru');
        });
        if (!users.length) {
            box.appendChild(this.note('Аккаунтов пока нет.'));
            return;
        }
        users.forEach(function (user) {
            box.appendChild(self.assignmentRow(user));
        });
    },

    assignmentRow: function (user) {
        var row = document.createElement('div');
        row.className = 'sound-row';

        var name = document.createElement('span');
        name.className = 'sound-key';
        name.textContent = user.display_name;
        row.appendChild(name);

        var select = document.createElement('select');
        select.className = 'sound-select';

        var none = document.createElement('option');
        none.value = '';
        none.textContent = '— по умолчанию —';
        select.appendChild(none);

        // Системные в список не идут: `default` играет и так, а `intro`
        // разослан на все устройства кнопкой в шапке и джинглом не служит.
        Quiz.store.sounds.filter(function (s) { return !s.is_system; })
            .forEach(function (sound) {
                var option = document.createElement('option');
                option.value = sound.key;
                option.textContent = sound.key;
                select.appendChild(option);
            });

        // Если назначенный звук успели удалить, ключ остался висячим и в
        // списке его нет — select молча показал бы первый пункт. Добавляем
        // его отдельной пометкой, иначе ведущий не увидит, что человек
        // остался без джингла.
        var current = user.sound_key || '';
        if (current && !Quiz.store.soundFor(current)) {
            var lost = document.createElement('option');
            lost.value = current;
            lost.textContent = current + ' (файла нет)';
            select.appendChild(lost);
        }
        select.value = current;

        select.addEventListener('change', function () {
            var value = select.value;
            Quiz.db.setProfileSound(user.id, value)
                .then(function () {
                    // profile подпиской не возвращается, поэтому локальную
                    // копию обновляем сами: без этого следующая перерисовка
                    // (её вызывает любое realtime-событие) вернула бы select
                    // к прежнему значению. В participant ключ доедет копией
                    // через триггер, и буззер заиграет новый джингл.
                    user.sound_key = value || null;
                })
                .catch(function (err) {
                    console.warn('Звук не назначен:', err.message);
                });
        });
        row.appendChild(select);

        row.appendChild(this.button('▶', 'Прослушать этот джингл', function () {
            Quiz.audio.play(select.value);
        }));
        return row;
    },

    note: function (text) {
        var node = document.createElement('div');
        node.className = 'sound-note';
        node.textContent = text;
        return node;
    },

    /** Разделитель между системными звуками и остальными; стиль — в admin.css. */
    separator: function () {
        var sep = document.createElement('div');
        sep.className = 'panel-separator';
        return sep;
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
