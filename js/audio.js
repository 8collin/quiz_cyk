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
 *
 * Отдельная забота — запрет автоплея. Браузер не даёт звучать странице, по
 * которой ни разу не коснулись, а джингл прилетает по realtime, то есть
 * без всякого участия хозяина телефона. Снимает запрет `unlock()`, и
 * зовётся он только из обработчика касания — см. `armUnlock` и
 * js/ui/gate.js.
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

    /** Снят ли запрет автоплея. Ставится синхронно, ещё внутри касания. */
    unlocked: false,

    /**
     * Элементы, разблокированные касанием.
     *
     * Chrome снимает запрет со всей страницы, и одного касания хватило бы
     * где угодно. Safari считает иначе: разблокирован КОНКРЕТНЫЙ <audio>,
     * на котором `play()` позвали внутри обработчика касания, — и обратно
     * запрет не возвращается, даже когда элементу меняют `src`. Поэтому
     * джингл играет переиспользованным элементом отсюда, а не свежим
     * `new Audio()`: свежий родился бы вне касания и на айфоне промолчал.
     */
    pool: [],

    /** Сколько звуков должно уметь идти внахлёст (интро поверх джингла). */
    POOL_SIZE: 4,

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

    /**
     * Ждать первого касания страницы и снять на нём запрет автоплея.
     *
     * Касание годится любое: нажатие «Войти» на форме входа, тап по кнопке
     * шлюза, случайный тычок в экран. Слушатель перехватывающий (capture) и
     * одноразовый — до `click` по кнопке шлюза он успевает, и разблокировка
     * оказывается сделанной ещё до того, как обработчик кнопки начнётся.
     */
    armUnlock: function () {
        var self = this;
        var fire = function () {
            document.removeEventListener('pointerdown', fire, true);
            document.removeEventListener('keydown', fire, true);
            self.unlock();
        };
        document.addEventListener('pointerdown', fire, true);
        document.addEventListener('keydown', fire, true);
    },

    /**
     * Снять запрет автоплея. Звать МОЖНО ТОЛЬКО синхронно из обработчика
     * касания: разрешение выдаётся под жест, и `await` перед этим вызовом
     * его теряет.
     *
     * Повторный вызов ничего не делает — обработчик кнопки шлюза зовёт эту
     * функцию вслед за `armUnlock`, и оба пути ведут сюда.
     */
    unlock: function () {
        if (this.unlocked) return;
        this.unlocked = true;

        var self = this;
        var watched = false;
        for (var i = 0; i < this.POOL_SIZE; i++) {
            var clip = new Audio(Quiz.config.SILENCE_WAV);
            clip.volume = 0;
            var started = clip.play();
            this.pool.push(clip);

            // Хватит следить за одним: отказ означает, что касания не было
            // вовсе, и тогда бесполезен весь пул. Возвращаем всё как было,
            // чтобы шлюз показался и дал настоящее касание.
            if (watched || !started || !started.catch) continue;
            watched = true;
            started.catch(function (err) {
                self.unlocked = false;
                self.pool = [];
                console.log('Разблокировать звук не удалось:', err && err.message);
            });
        }
    },

    /**
     * Элемент, которым будем играть: свободный из разблокированного пула,
     * а если пула нет или все заняты — свежий. Свежий звучит везде, кроме
     * айфона без касания, где не звучит ничего и подавно.
     */
    claim: function (url) {
        for (var i = 0; i < this.pool.length; i++) {
            var clip = this.pool[i];
            if (clip.quizBusy) continue;
            clip.quizBusy = true;
            clip.src = url;
            return clip;
        }
        return new Audio(url);
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

        var clip = this.claim(url);
        var gain = this.gainFor(key);
        // Множитель едет с самим элементом: иначе setVolume, идущий по
        // списку играющих, не знал бы, на что умножать.
        clip.quizGain = gain;
        clip.volume = this.volume * gain;
        this.active.push(clip);

        // Элемент из пула переживает проигрывание и ждёт следующего, так
        // что за собой надо убрать полностью: неснятые слушатели копились
        // бы на нём от джингла к джинглу.
        var cleanup = function () {
            clip.removeEventListener('ended', cleanup);
            clip.removeEventListener('error', cleanup);
            clip.quizBusy = false;
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
