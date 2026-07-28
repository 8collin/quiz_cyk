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
        Quiz.dom.on('btn-sounds-close', 'click', function () { self.toggle(); });

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
        Quiz.store.sounds.forEach(function (sound) {
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

        if (!sound.is_system) {
            row.appendChild(this.button('✕', 'Удалить звук', function () {
                self.remove(sound);
            }, 'is-danger'));
        }
        return row;
    },

    remove: async function (sound) {
        var users = Quiz.store.participants.filter(function (p) {
            return p.sound_key === sound.key;
        });
        var warning = users.length
            ? '\n\nОн назначен игрокам: ' +
              users.map(function (p) { return p.display_name; }).join(', ') +
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

    /** Кому какой джингл. Список участников — той же игры, что на экране. */
    renderAssignments: function () {
        var self = this;
        var box = Quiz.dom.el('sounds-players');
        box.textContent = '';

        var players = Quiz.store.participants.slice().sort(function (a, b) {
            return a.display_name.localeCompare(b.display_name, 'ru');
        });
        if (!players.length) {
            box.appendChild(this.note('В игре пока никого нет.'));
            return;
        }
        players.forEach(function (participant) {
            box.appendChild(self.assignmentRow(participant));
        });
    },

    assignmentRow: function (participant) {
        var row = document.createElement('div');
        row.className = 'sound-row';

        var name = document.createElement('span');
        name.className = 'sound-key';
        name.textContent = participant.display_name;
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

        // Если назначенный звук успели удалить, ключ в строке остался
        // висячим и в списке его нет — select молча показал бы первый
        // пункт. Добавляем его отдельной пометкой, иначе ведущий не
        // увидит, что игрок остался без джингла.
        var current = participant.sound_key || '';
        if (current && !Quiz.store.soundFor(current)) {
            var lost = document.createElement('option');
            lost.value = current;
            lost.textContent = current + ' (файла нет)';
            select.appendChild(lost);
        }
        select.value = current;

        select.addEventListener('change', function () {
            Quiz.db.setParticipantSound(participant.id, select.value)
                .catch(function (err) {
                    console.warn('Звук игроку не назначен:', err.message);
                });
        });
        row.appendChild(select);

        row.appendChild(this.button('▶', 'Прослушать джингл этого игрока', function () {
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
