/**
 * Sound playback and the volume slider.
 *
 * Jingles are addressed by `sound_key`, not by login: renaming a player
 * must not silently break their sound, which is what happened when the
 * file name had to equal the login.
 */
Quiz.audio = {
    /** 0..1, mirrored in localStorage so it survives a reload. */
    volume: 1,

    /** Currently playing clips, kept so the slider can affect them live. */
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
        // Includes the intro, which may be several seconds in by now.
        this.active.forEach(function (clip) { clip.volume = this.volume; }, this);
    },

    /** 'Алина' -> 'audio/Алина.mp3' */
    urlFor: function (soundKey) {
        return Quiz.config.AUDIO_PATH + soundKey + '.mp3';
    },

    /**
     * Plays a jingle, falling back to the default clip when the file is
     * missing. A blocked autoplay is logged and swallowed: a silent
     * buzzer is a nuisance, a thrown error would break the round.
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
