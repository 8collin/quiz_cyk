/**
 * Персональный размер текста вопроса и ответа.
 *
 * Живёт только на устройстве, как и громкость (Quiz.audio): множитель
 * пишется в localStorage и в инлайн-стиль <body> как переменная
 * --q-scale, откуда наследуется в .question-text и .answer-text. Их
 * размер — база под текущий экран (--q-font / --a-font, задаётся в CSS по
 * ролям и медиазапросам) умножить на этот множитель. В базу, store и
 * realtime ничего не уходит: у каждого свой, и разъехаться со «своим у
 * соседа» тут нечему.
 *
 * Пределы захардкожены и наружу не вынесены: за них выйти нельзя, иначе
 * игрок сам сделает себе текст либо не влезающим в карточку, либо
 * нечитаемо мелким, и не поймёт, как вернуть.
 */
Quiz.textScale = {
    STORAGE_KEY: 'quiz_text_scale',

    /* Границы множителя и шаг кнопок A− / A+. 0.3..1.8 с шагом 0.1 — от
       очень мелкого до полутора с лишним крат базового размера. Нижняя
       граница намеренно такая низкая (на телефоне игрока это ~5px) — так
       захотел владелец; это не забытый дефолт и не опечатка. */
    MIN: 0.3,
    MAX: 1.8,
    STEP: 0.1,

    /** Текущий множитель, 0.8..1.8. Дублируется в localStorage. */
    scale: 1,

    /** Читает сохранённое, зажимает в границы и применяет к странице. */
    load: function () {
        var saved = parseFloat(localStorage.getItem(this.STORAGE_KEY));
        this.scale = isNaN(saved) ? 1 : this.clamp(saved);
        this.apply();
        return this.scale;
    },

    clamp: function (value) {
        return Math.max(this.MIN, Math.min(this.MAX, value));
    },

    /** Ставит множитель на <body>; переменная наследуется в текст. */
    apply: function () {
        document.body.style.setProperty('--q-scale', String(this.scale));
    },

    /**
     * Сохраняет и применяет новое значение, вернув фактическое (после
     * зажатия в границы и округления до шага). Округление обязательно:
     * 0.1 в double неточна, и без него множитель накопил бы хвост вида
     * 1.4000000000000001, а сравнение с границей в atMax() стало бы
     * зыбким.
     */
    set: function (value) {
        var stepped = Math.round(this.clamp(value) / this.STEP) * this.STEP;
        this.scale = Math.round(stepped * 100) / 100;
        localStorage.setItem(this.STORAGE_KEY, String(this.scale));
        this.apply();
        return this.scale;
    },

    /** Кнопки A− / A+: сдвиг на один шаг (direction: -1 или +1). */
    bump: function (direction) {
        return this.set(this.scale + direction * this.STEP);
    },

    /* На границах соответствующую кнопку гасят, чтобы нажатие впустую не
       выглядело поломкой. Допуск — против неточности double у самого края. */
    atMin: function () { return this.scale <= this.MIN + 1e-9; },
    atMax: function () { return this.scale >= this.MAX - 1e-9; }
};
