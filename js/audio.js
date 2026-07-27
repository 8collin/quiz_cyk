/**
 * Воспроизведение звуков и ползунок громкости.
 *
 * Джингл адресуется по `sound_key`, а не по логину: переименование игрока
 * не должно молча ломать ему звук, а именно это и происходило, когда имя
 * файла обязано было совпадать с логином.
 */
Quiz.audio = {
    /** 0..1, дублируется в localStorage, чтобы пережить перезагрузку. */
    volume: 1,

    /** Играющие прямо сейчас клипы — чтобы ползунок влиял на них на лету. */
    active: [],

    STORAGE_KEY: 'quiz_volume',

    load: function () {
        var saved = parseFloat(localStorage.getItem(this.STORAGE_KEY));
        this.volume = isNaN(saved) ? 1 : Math.max(0, Math.min(1, saved));
        return this.volume;
    },

    setVolume: function (percent) {
        this.volume = Math.max(0, Math.min(1, Number(percent) / 100));
        localStorage.setItem(this.STORAGE_KEY, String(this.volume));
        // Включая интро, которое к этому моменту может играть уже несколько секунд.
        this.active.forEach(function (clip) { clip.volume = this.volume; }, this);
    },

    /** 'Алина' -> 'audio/Алина.mp3' */
    urlFor: function (soundKey) {
        return Quiz.config.AUDIO_PATH + soundKey + '.mp3';
    },

    /**
     * Играет джингл, откатываясь на файл по умолчанию, если своего нет.
     * Заблокированный браузером автоплей логируется и проглатывается:
     * немой буззер — неудобство, а брошенное исключение сломало бы раунд.
     */
    play: function (soundKey, allowFallback) {
        var url = this.urlFor(soundKey || Quiz.config.DEFAULT_SOUND);
        var clip = new Audio(url);
        var self = this;

        clip.volume = this.volume;
        this.active.push(clip);

        var cleanup = function () {
            self.active = self.active.filter(function (c) { return c !== clip; });
        };
        clip.addEventListener('ended', cleanup);
        clip.addEventListener('error', cleanup);

        clip.play().catch(function (err) {
            cleanup();
            var fallback = Quiz.config.DEFAULT_SOUND;
            if (allowFallback !== false && soundKey !== fallback) {
                self.play(fallback, false);
            } else {
                console.log('Звук не проигран:', url, err && err.message);
            }
        });
    }
};
