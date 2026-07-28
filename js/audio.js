/**
 * Воспроизведение звуков и ползунок громкости.
 *
 * Джингл адресуется по `sound_key`, а не по логину: переименование игрока
 * не должно молча ломать ему звук, а именно это и происходило, когда имя
 * файла обязано было совпадать с логином.
 *
 * Файлы живут в Storage, а не папкой рядом со страницей: ведущий меняет
 * их из панели, в том числе посреди игры. Адрес и личную громкость звука
 * этот файл берёт из Quiz.store — то есть из строки `sound`, которую
 * realtime держит свежей. Ходить в сеть за ними он не умеет вовсе.
 *
 * Две громкости, и они перемножаются:
 *
 *     clip.volume = локальный ползунок × sound.volume
 *
 * Локальный живёт в localStorage и у каждого свой — он про «мне здесь
 * громко». Второй общий и лежит в базе — он про «этот файл записан
 * громче остальных». Поэтому у каждого играющего клипа надо помнить его
 * собственный множитель: иначе движение ползунка сравняло бы громкости,
 * которые ведущий развёл нарочно.
 */
Quiz.audio = {
    /** 0..1, дублируется в localStorage, чтобы пережить перезагрузку. */
    volume: 1,

    /** Играющие прямо сейчас клипы — чтобы ползунок влиял на них на лету. */
    active: [],

    /**
     * Ключ -> Audio, созданный только ради прогрева кеша браузера.
     *
     * Локальный файл играл мгновенно, сетевой стоит кругового похода — а
     * джингл буззера обязан звучать сразу. Эти элементы ничего не играют:
     * они лишь заставляют браузер скачать байты заранее, и следующий
     * `new Audio(url)` возьмёт их из кеша. Отдельный элемент на каждое
     * проигрывание нужен, чтобы интро и джингл могли звучать внахлёст.
     */
    warmed: {},

    STORAGE_KEY: 'quiz_volume',

    load: function () {
        var saved = parseFloat(localStorage.getItem(this.STORAGE_KEY));
        this.volume = isNaN(saved) ? 1 : Math.max(0, Math.min(1, saved));
        return this.volume;
    },

    setVolume: function (percent) {
        this.volume = Math.max(0, Math.min(1, Number(percent) / 100));
        localStorage.setItem(this.STORAGE_KEY, String(this.volume));
        // Включая интро, которое к этому моменту может играть уже
        // несколько секунд. Личный множитель клипа при этом сохраняется.
        this.active.forEach(function (clip) {
            clip.volume = this.volume * clip.quizGain;
        }, this);
    },

    /** Адрес файла по ключу. null, когда такого звука в базе нет. */
    urlFor: function (soundKey) {
        var sound = Quiz.store.soundFor(soundKey);
        return sound ? Quiz.db.soundUrl(sound.path) : null;
    },

    /** Личная громкость звука, 0..1. Для незнакомого ключа — полная. */
    gainFor: function (soundKey) {
        var sound = Quiz.store.soundFor(soundKey);
        var gain = sound ? Number(sound.volume) : 1;
        return isNaN(gain) ? 1 : Math.max(0, Math.min(1, gain));
    },

    /**
     * Скачать всё заранее.
     *
     * Зовётся после загрузки списка звуков. Повторный вызов пропускает
     * уже прогретые: список меняется по realtime, и перекачивать всё
     * из-за одного передвинутого ползунка незачем. Смена файла у звука
     * меняет и путь, поэтому такой ключ прогреется заново.
     */
    warmUp: function () {
        var self = this;
        Quiz.store.sounds.forEach(function (sound) {
            var url = Quiz.db.soundUrl(sound.path);
            if (!url || self.warmed[sound.key] === url) return;
            var clip = new Audio();
            clip.preload = 'auto';
            clip.src = url;
            self.warmed[sound.key] = url;
        });
    },

    /**
     * Играет джингл, откатываясь на файл по умолчанию, если своего нет.
     *
     * Откат срабатывает и когда ключа нет в базе, и когда файл не
     * проигрался: для игрока это одно и то же — джингл не зазвучал.
     * Заблокированный браузером автоплей логируется и проглатывается:
     * немой буззер — неудобство, а брошенное исключение сломало бы раунд.
     */
    play: function (soundKey, allowFallback) {
        var self = this;
        var fallback = Quiz.config.DEFAULT_SOUND;
        var key = soundKey || fallback;
        var url = this.urlFor(key);

        var giveUp = function (reason) {
            if (allowFallback !== false && key !== fallback) {
                self.play(fallback, false);
            } else {
                console.log('Звук не проигран:', key, reason);
            }
        };

        if (!url) return giveUp('нет такого звука в базе');

        var clip = new Audio(url);
        var gain = this.gainFor(key);
        // Множитель едет с самим элементом: иначе setVolume, идущий по
        // списку играющих, не знал бы, на что умножать.
        clip.quizGain = gain;
        clip.volume = this.volume * gain;
        this.active.push(clip);

        var cleanup = function () {
            self.active = self.active.filter(function (c) { return c !== clip; });
        };
        clip.addEventListener('ended', cleanup);
        clip.addEventListener('error', cleanup);

        clip.play().catch(function (err) {
            cleanup();
            giveUp(err && err.message);
        });
    }
};
