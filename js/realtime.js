/**
 * Подписки realtime — единственное, что пишет в Quiz.store по ходу раунда.
 *
 * Урок, оплаченный старой версией: после того как ведущий сменил вопрос,
 * НЕ рассчитывайте, что каналы buzz и participant догонят сами. Это
 * отдельные подписки, они могут отстать от строки game, и тогда подсветка
 * «отвечает» и бейджи с песочными часами залипают. Перечитывайте
 * затронутые таблицы явно — этим занимается reloadQuestionScoped().
 *
 * Второй урок, оплаченный уже этой версией: обработчик не имеет права
 * умереть по дороге к onChange(). Перечитка ходит в сеть шесть раз подряд,
 * и на телефоне любой из них может не дойти; исключение, вылетевшее из
 * async-обработчика, отменяло отрисовку целиком — экран оставался на
 * прошлом вопросе, хотя store.game описывал уже новый. Поэтому всякая
 * перечитка внутри обработчика идёт через reloadSafely, а onChange()
 * зовётся в любом случае.
 *
 * События DELETE приходят с полной старой строкой только потому, что у
 * `buzz` и `participant` выставлен replica identity full (см. 001_schema).
 * С настройкой по умолчанию в payload лежал бы один первичный ключ, и
 * серверный фильтр по game_id не совпал бы вовсе.
 */
Quiz.realtime = {
    channel: null,

    /** id игры, на которую сейчас подписаны, — нужен переподключению. */
    gameId: null,

    /** Живо ли соединение прямо сейчас. Ведёт _handleStatus. */
    connected: false,

    /**
     * Хотим ли мы вообще быть подключёнными. Ставится в false явным
     * unsubscribe() (выход, переезд на другую игру) и гасит фоновое
     * переподключение: без этого таймер поднял бы канал на игру, которую
     * мы только что покинули.
     */
    wantConnection: false,

    /** Восстановились после обрыва — при следующем SUBSCRIBED перечитать. */
    pendingRecovery: false,

    reconnectTimer: null,
    reconnectDelay: 0,

    /** Таймер «связь продержалась достаточно, чтобы считать её настоящей». */
    stableTimer: null,

    /**
     * Уже сообщили в консоль об обрыве — чтобы не повторять это на каждом
     * тике мелькающего переподключения. Снимается, когда связь устоялась.
     */
    announcedDown: false,

    /** Ставится из main.js: чем перерисовывать после каждого изменения. */
    onChange: function () {},

    /**
     * Ставится из main.js: как меняется состояние связи (true/false).
     * По нему интерфейс показывает полосу «переподключаюсь».
     */
    onStatus: function () {},

    /**
     * Ставится из main.js: перечитать состояние после переподключения.
     * Пропущенные за время простоя события realtime не доигрывает, поэтому
     * store надо освежить руками.
     */
    onRecovered: function () {},

    /**
     * Ставится из main.js: что делать, когда игра перестала быть идущей.
     *
     * Подписка привязана к одному id, так что о переезде на другую игру
     * узнать больше неоткуда. Ведущий переключает игру у себя — все
     * остальные видят только то, что их игра сменила статус.
     */
    onGameClosed: function () {},

    /**
     * Подписка на изменения игры. Возвращает промис, который разрешается,
     * когда подписка подтверждена (или когда стало ясно, что сейчас не
     * выйдет), и ждать его обязательно. Присоединение к каналу занимает
     * время, а запись, сделанная сразу после subscribe(), пройдёт мимо
     * ещё не готовой подписки: в базе всё верно, а экран показывает
     * прошлое состояние до следующего события. Ловится это на цепочке
     * «переключил игру и тут же что-то сделал» — то есть на импорте.
     */
    subscribe: function (gameId) {
        this.unsubscribe();
        this.gameId = gameId;
        this.wantConnection = true;
        this.pendingRecovery = false;
        this.reconnectDelay = 0;
        this.announcedDown = false;
        this._startWatchdog();
        return this._join();
    },

    /**
     * Сколько ждём подтверждения, прежде чем отдать управление дальше без
     * него. SDK обещает свой TIMED_OUT секунд за десять, но полагаться
     * только на него нельзя: промис subscribe() обязан разрешиться сам,
     * иначе загрузка повиснет на мёртвой сети — ровно это и случилось у
     * игрока, чей канал не встал, а единственная отрисовка ждала за ним.
     */
    JOIN_TIMEOUT_MS: 12000,

    /** Потолок паузы между попытками переподключения. */
    RECONNECT_MAX_MS: 15000,

    /**
     * Сколько канал должен продержаться, прежде чем считать связь
     * устойчивой: только тогда гасится бэкофф и печатается «восстановлено».
     * Без этого мелькающее «встал-упал» сбрасывало бы задержку в ноль на
     * каждом подъёме и долбило бы переподключением раз в секунду.
     *
     * Заведена эта выдержка была против мельтешения, которое на самом деле
     * устраивал себе `_teardownChannel` — там же и написано, как. Цикл она
     * не лечила, а растягивала до пятнадцати секунд; причина убрана, а
     * выдержка осталась: против настоящей сети, которая перестраивается
     * после смены VPN или маршрута, она верна по-прежнему и держит консоль
     * тихой — одна строка на обрыв, одна на возврат.
     */
    STABLE_MS: 4000,

    /**
     * Заводит канал на текущую игру и вешает обработчики. Вынесено из
     * subscribe, потому что переподключение делает ровно то же самое —
     * канал каждый раз новый (см. _scheduleReconnect).
     */
    _wire: function () {
        var self = this;
        var gameId = this.gameId;
        var forThisGame = 'game_id=eq.' + gameId;

        this.channel = Quiz.db.client.channel('quiz-' + gameId);
        this.channel
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'game', filter: 'id=eq.' + gameId },
                function (payload) { self.handleGame(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'participant', filter: forThisGame },
                function (payload) { self.handleParticipant(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'buzz', filter: forThisGame },
                function (payload) { self.handleBuzz(payload); })
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'answer_log', filter: forThisGame },
                function (payload) { self.handleAnswerLog(payload); })
            // Звуки к игре не привязаны, поэтому и фильтра нет. Заодно это
            // единственная здешняя подписка, у которой DELETE доходит с
            // одним первичным ключом и этого хватает: отбрасывать событие
            // серверу не по чему, а ключа довольно, чтобы убрать строку.
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'sound' },
                function (payload) { self.handleSound(payload); })
            .on('broadcast', { event: 'intro' },
                function () { Quiz.audio.play(Quiz.config.INTRO_SOUND); });
    },

    /**
     * Присоединяется к заведённому каналу. Промис разрешается на первом же
     * статусе от SDK или по сторожевому таймауту — что раньше, но ровно
     * один раз.
     */
    _join: function () {
        var self = this;
        this._wire();
        var channel = this.channel;

        return new Promise(function (resolve) {
            var settled = false;
            var guard = setTimeout(function () {
                if (settled) return;
                settled = true;
                resolve(false);
            }, self.JOIN_TIMEOUT_MS);

            channel.subscribe(function (status) {
                // Колбэк канала, который мы уже сменили (переезд игры или
                // переподключение), нас не касается: у него свой статус, а
                // this.channel давно другой.
                if (self.channel !== channel) return;

                self._handleStatus(status);

                if (!settled) {
                    settled = true;
                    clearTimeout(guard);
                    resolve(status === 'SUBSCRIBED');
                }
            });
        });
    },

    /**
     * Реакция на смену статуса канала — и на подтверждение, и на обрыв.
     *
     * Урок инцидента: раньше здесь не было ничего, кроме console.log, и
     * оборванный канал оставался мёртвым до перезагрузки страницы. Теперь
     * обрыв заводит переподключение, а восстановление — перечитку: за
     * время простоя события прошли мимо, и store их не видел.
     */
    _handleStatus: function (status) {
        // Поздний колбэк уже снятого канала (removeChannel мог прислать
        // CLOSED вдогонку). Этого канала мы больше не хотим — молчим.
        if (!this.wantConnection) return;

        if (status === 'SUBSCRIBED') {
            this.connected = true;
            this.onStatus(true);

            // Бэкофф здесь НЕ гасим: канал, который встаёт и тут же падает,
            // иначе сбрасывал бы задержку в ноль на каждом подъёме — отсюда
            // ровный «SUBSCRIBED/CLOSED» раз в секунду. Сброс задержки и
            // отметку «восстановлено» отдаём таймеру устойчивости.
            this._armStableTimer();

            if (this.pendingRecovery) {
                this.pendingRecovery = false;
                this.onRecovered();
            }
            return;
        }

        // CHANNEL_ERROR / TIMED_OUT / CLOSED — всё, что не подтверждение.
        this._clearStableTimer();
        if (this.connected && !this.announcedDown) {
            console.log('realtime: соединение потеряно —', status);
            this.announcedDown = true;
        }
        this.connected = false;
        this.onStatus(false);
        this._scheduleReconnect();
    },

    /**
     * Заводит таймер устойчивости. Продержалась связь STABLE_MS — гасим
     * бэкофф и, если раньше жаловались на обрыв, печатаем «восстановлено».
     * Мелькание «встал-упал» до таймера не доживает, поэтому в консоль и не
     * попадает: одна строка на обрыв, одна на возврат.
     */
    _armStableTimer: function () {
        var self = this;
        this._clearStableTimer();
        this.stableTimer = setTimeout(function () {
            self.stableTimer = null;
            self.reconnectDelay = 0;
            if (self.announcedDown) {
                console.log('realtime: соединение восстановлено');
                self.announcedDown = false;
            }
        }, this.STABLE_MS);
    },

    _clearStableTimer: function () {
        if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = null;
        }
    },

    /**
     * Переподключение с нарастающей паузой. Канал каждый раз заводится
     * ЗАНОВО: убрать старый и создать новый — это заодно поднимает свежий
     * сокет (SDK рвёт соединение, когда каналов не осталось, и открывает
     * новое под новый канал), а именно повисший сокет переживает сон
     * машины, из-за которого канал уже не оживал сам.
     */
    _scheduleReconnect: function () {
        var self = this;
        if (this.reconnectTimer || !this.wantConnection) return;

        // Когда поднимемся — надо будет перечитать пропущенное.
        this.pendingRecovery = true;
        this.reconnectDelay = Math.min((this.reconnectDelay || 500) * 2, this.RECONNECT_MAX_MS);

        this.reconnectTimer = setTimeout(function () {
            self.reconnectTimer = null;
            if (!self.wantConnection) return;
            self._teardownChannel();
            self._join();
        }, this.reconnectDelay);
    },

    /**
     * Снимает канал. Порядок двух строк здесь значим и стоил бесконечного
     * цикла переподключений.
     *
     * `removeChannel()` зовёт внутри leave(), а тот первым делом ставит
     * каналу состояние `leaving` — из-за чего его же проверка `canPush()`
     * даёт false, и закрытие срабатывает ЛОКАЛЬНО, в этом же тике. То есть
     * колбэк из `_join()` получает `CLOSED` ещё до того, как
     * `removeChannel()` вернёт управление. Пока `this.channel` указывает на
     * снимаемый канал, охранник `self.channel !== channel` этот CLOSED не
     * отсеивает, и `_handleStatus` принимает наш собственный уход за обрыв:
     * заводит ещё одно переподключение, а оно потом убивает только что
     * поднятый канал. Один настоящий обрыв — и дальше «восстановлено /
     * потеряно» раз в пятнадцать секунд до перезагрузки страницы
     * (docs/decisions.md, этап 15).
     */
    _teardownChannel: function () {
        if (this.channel) {
            var channel = this.channel;
            this.channel = null;
            Quiz.db.client.removeChannel(channel);
        }
    },

    /**
     * Явный разрыв: выход, переезд на другую игру. Гасит переподключение —
     * иначе фоновый таймер поднял бы канал на покинутую игру.
     */
    unsubscribe: function () {
        this.wantConnection = false;
        this.pendingRecovery = false;
        this.announcedDown = false;
        // Гасит отложенные повторы перечитки: игру мы покидаем, и класть
        // их результат будет уже некуда. subscribe() зовёт unsubscribe()
        // первой строкой, так что переезд на другую игру покрыт тоже.
        this.reloadGeneration++;
        this._stopWatchdog();
        this._clearStableTimer();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this._teardownChannel();
        this.connected = false;
    },

    /** Интро играет у всех сразу — своё воспроизведение ведущий запускает сам. */
    sendIntro: function () {
        if (!this.channel) return;
        this.channel.send({ type: 'broadcast', event: 'intro', payload: {} });
    },

    // --- Сторож: событие, которое не доехало ------------------------------
    //
    // Realtime ничего не обещает. Событие может не дойти, и канал при этом
    // останется `joined`, сокет — открытым, а `connected` — true: полоса
    // «переподключаюсь» не покажется, переподключения не будет, перечитки
    // тоже. Экран так и останется на прошлом вопросе до перезагрузки
    // страницы — ровно это и увидел игрок (docs/decisions.md, этап 16).
    // Проверено на живой паре вкладок: оба клиента разом не получили UPDATE
    // строки game, хотя в базе он был, а канал у обоих числился живым.
    //
    // Поэтому строку game сверяем сами. Это НЕ тот опрос базы, которого в
    // проекте быть не должно: отсчёт по-прежнему рисуется из кеша пять раз
    // в секунду, а здесь один крохотный GET раз в WATCHDOG_MS и только
    // пока вкладка на виду.

    /** Как часто сверяем строку game, даже когда канал жив. */
    WATCHDOG_MS: 10000,

    watchdogTimer: null,

    _startWatchdog: function () {
        var self = this;
        this._stopWatchdog();
        this.watchdogTimer = setInterval(function () { self.syncGame(); },
                                         this.WATCHDOG_MS);
    },

    _stopWatchdog: function () {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    },

    /**
     * Сверяет строку game с тем, что лежит в store, и, если разошлись,
     * проводит разницу тем же обработчиком, что и настоящее событие, —
     * чтобы догоняющий путь не разъехался с основным.
     *
     * Зовётся сторожем по таймеру и из main.js, когда вкладка возвращается
     * на экран: пока телефон был погашен, таймеры стояли, а ведущий нет.
     */
    syncGame: async function () {
        if (!this.gameId || !this.wantConnection) return;
        // Вкладка не на виду — сверяться незачем: покажем её всё равно не
        // раньше, чем на неё посмотрят, а к тому моменту сверка уже будет.
        if (document.hidden) return;
        // Идёт полная загрузка (переезд на другую игру) — не мешаем.
        if (!Quiz.store.game || Quiz.store.game.id !== this.gameId) return;

        var row;
        try {
            row = await Quiz.db.getGame(this.gameId);
        } catch (err) {
            // Сеть моргнула — следующая сверка попробует снова.
            return;
        }

        // Игру удалили, а DELETE до нас не доходит: у канала подписан
        // только UPDATE (см. game.deleteGame).
        if (!row) {
            this.onGameClosed();
            return;
        }

        if (!this._differs(row)) return;

        if (row.current_question_id !==
            (Quiz.store.game || {}).current_question_id) {
            console.warn('Событие game не дошло — догоняем сверкой.');
        }
        await this.handleGame({ new: row });
    },

    /** Поля, по которым видно, что событие прошло мимо нас. */
    WATCHED_FIELDS: ['status', 'current_question_id', 'show_answer',
                     'show_stats', 'think_base_ms', 'think_since'],

    _differs: function (row) {
        var mine = Quiz.store.game || {};
        return this.WATCHED_FIELDS.some(function (field) {
            return mine[field] !== row[field];
        });
    },

    // --- Обработчики -----------------------------------------------------

    handleGame: async function (payload) {
        var previous = Quiz.store.game;
        var next = payload.new;

        Quiz.store.game = next;
        Quiz.timing.applyGameRow(next);

        // Игру закрыли или отложили — значит, идущая теперь другая, и
        // перечитывать надо не части, а всё вместе с подпиской.
        if (next.status !== 'running') {
            this.onGameClosed();
            return;
        }

        var questionChanged = !previous ||
            previous.current_question_id !== next.current_question_id;
        var revealChanged = !previous ||
            previous.show_answer !== next.show_answer;

        if (questionChanged) {
            // Вот та самая явная перечитка. Подписки на buzz и participant
            // придут своим темпом, а до тех пор состояние в памяти описывает
            // предыдущий вопрос.
            //
            // Через reloadSafely, а не напрямую: голый await здесь уносил
            // исключение мимо onChange() и оставлял игрока на прошлом
            // вопросе до перезагрузки страницы (см. заголовок файла).
            if (!(await this.reloadSafely(this.reloadQuestionScoped))) {
                // Не прошла — значит, в store лежит состояние ПРОШЛОГО
                // вопроса, и оно теперь неверно: засчитанный там «+2»
                // держал бы буззер закрытым на новом вопросе, а строка
                // buzz — подсветку «отвечает». Пусто лучше, чем неверно:
                // жать буззер база всё равно рассудит сама, а повтор
                // перечитки вернёт настоящее состояние.
                this.dropQuestionScoped();
            }
        } else if (revealChanged) {
            if (!(await this.reloadSafely(this.reloadRevealedAnswer))) {
                // Та же логика в мелком масштабе: не смогли узнать, открыт
                // ли ответ, — прячем. Показать чужой ответ хуже, чем не
                // показать свой.
                Quiz.store.revealedAnswer = null;
            }
        }

        this.onChange();
    },

    handleParticipant: function (payload) {
        var list = Quiz.store.participants;

        if (payload.eventType === 'DELETE') {
            Quiz.store.participants = list.filter(function (p) {
                return p.id !== payload.old.id;
            });
        } else {
            Quiz.store.participants = this.upsert(list, payload.new);
        }
        this.onChange();
    },

    handleBuzz: function (payload) {
        if (payload.eventType === 'DELETE') {
            Quiz.store.buzz = null;
        } else {
            Quiz.store.buzz = payload.new;
            this.playJingleFor(payload.new.participant_id);
        }
        this.onChange();
    },

    /**
     * Звук завели, переименовали, переозвучили или сдвинули ему ползунок.
     *
     * Доехать это обязано до каждого устройства, а не только до ведущего:
     * джингл играет у всех сразу, и громкость к нему применяет тот, у
     * кого он звучит. Прогрев вызывается здесь же — у нового или
     * перезалитого звука меняется путь, и его надо скачать заранее, а не
     * в момент, когда кто-то нажмёт буззер.
     */
    handleSound: function (payload) {
        var list = Quiz.store.sounds;

        if (payload.eventType === 'DELETE') {
            Quiz.store.sounds = list.filter(function (s) {
                return s.id !== payload.old.id;
            });
        } else {
            Quiz.store.sounds = this.upsert(list, payload.new);
            Quiz.audio.warmUp();
        }
        this.onChange();
    },

    handleAnswerLog: function (payload) {
        var list = Quiz.store.answerLog;

        if (payload.eventType === 'DELETE') {
            Quiz.store.answerLog = list.filter(function (a) {
                return a.id !== payload.old.id;
            });
            Quiz.store.gameAnswerLog = Quiz.store.gameAnswerLog.filter(function (a) {
                return a.id !== payload.old.id;
            });
        } else {
            // Журнал игры принимает оценку любого вопроса — таблица
            // статистики считает по всей игре. Список текущего вопроса
            // по-прежнему берёт только своё.
            Quiz.store.gameAnswerLog = this.upsert(Quiz.store.gameAnswerLog, payload.new);
            if (payload.new.question_id === (Quiz.store.game || {}).current_question_id) {
                Quiz.store.answerLog = this.upsert(list, payload.new);
            }
        }
        this.onChange();
    },

    // --- Перечитки -------------------------------------------------------

    /** Сколько раз повторяем перечитку, которая не прошла. */
    RELOAD_RETRIES: 4,

    /** Базовая пауза между повторами, мс; растёт с номером попытки. */
    RELOAD_RETRY_MS: 800,

    /**
     * Номер поколения перечиток. Растёт на каждой новой и на смене
     * подписки, чем и гасит повторы, затеянные предыдущей: пока повтор
     * ждал свою паузу, ведущий мог уйти ещё на вопрос вперёд, и дочитывать
     * позапрошлый уже незачем — его результат затёр бы свежий.
     */
    reloadGeneration: 0,

    /**
     * Перечитка, которая переживает неудачу. Возвращает true, если прошла
     * с первого раза, и false, если нет; неудачную повторяет в фоне.
     *
     * Ради этого «false» всё и написано. Раньше обработчик ждал перечитку
     * голым await, и одна не прошедшая выборка — моргнула сеть на телефоне,
     * а их там шесть подряд — уносила исключение наружу, мимо onChange().
     * Экран не перерисовывался вовсе, хотя store.game уже описывал новый
     * вопрос. Следующее событие (сброс оси перед СЛЕДУЮЩИМ вопросом)
     * рисовало наконец этот, и игрок ехал ровно на вопрос позади ведущего
     * до перезагрузки страницы (docs/decisions.md, этап 16).
     *
     * Отсюда два правила, которые здесь и закреплены: обработчик realtime
     * не имеет права умереть по дороге к отрисовке, а перечитка не имеет
     * права провалиться молча и навсегда.
     */
    reloadSafely: async function (reload) {
        var generation = ++this.reloadGeneration;
        try {
            await reload.call(this);
            return true;
        } catch (err) {
            console.warn('Перечитка не прошла:', err.message);
            this._scheduleReloadRetry(reload, generation, 1);
            return false;
        }
    },

    /**
     * Повтор с нарастающей паузой. Удался — зовём onChange(): экран
     * дорисует то, чего в момент неудачи не было (счёт, штрафы,
     * засчитанный ответ). Не удался и попытки кончились — оставляем как
     * есть: вопрос на экране правильный, а остальное поправит первое же
     * событие или переподключение.
     */
    _scheduleReloadRetry: function (reload, generation, attempt) {
        var self = this;
        if (attempt > this.RELOAD_RETRIES) {
            console.warn('Перечитка не удалась ' + this.RELOAD_RETRIES +
                         ' раз подряд — состояние может отставать.');
            return;
        }

        setTimeout(function () {
            // Поколение сменилось — эту перечитку уже некуда класть.
            if (self.reloadGeneration !== generation) return;

            reload.call(self).then(function () {
                if (self.reloadGeneration !== generation) return;
                self.onChange();
            }, function (err) {
                if (self.reloadGeneration !== generation) return;
                console.warn('Повтор перечитки (' + attempt + ') не прошёл:',
                             err.message);
                self._scheduleReloadRetry(reload, generation, attempt + 1);
            });
        }, this.RELOAD_RETRY_MS * attempt);
    },

    /**
     * Снимает всё, что относилось к прошлому вопросу, не трогая список
     * вопросов и участников: те вопрос переживают, а эти три — нет.
     * Зовётся, только когда перечитка не прошла, — на удачном пути
     * состояние меняется целиком и разом, как и раньше.
     */
    dropQuestionScoped: function () {
        Quiz.store.buzz = null;
        Quiz.store.answerLog = [];
        Quiz.store.revealedAnswer = null;
    },

    /** Всё, что привязано к конкретному вопросу и не переживает его смены. */
    reloadQuestionScoped: async function () {
        var game = Quiz.store.game;
        if (!game) return;

        // Сам список вопросов сюда попал по необходимости: таблица
        // `question` в публикацию realtime не входит, поэтому импорт из
        // Excel и «Сброс игры» приезжают на чужие экраны только с этой
        // перечиткой. Момент подходящий — указатель на вопрос всё равно
        // меняется тогда же.
        Quiz.store.questions = await Quiz.db.getQuestions(game.id);

        Quiz.store.buzz = await Quiz.db.getCurrentBuzz(game.id);
        Quiz.store.participants = await Quiz.db.getParticipants(game.id);

        if (game.current_question_id) {
            Quiz.store.answerLog = await Quiz.db.getAnswerLog(game.current_question_id);
        } else {
            Quiz.store.answerLog = [];
        }

        // Журнал всей игры сюда попал по той же необходимости, что и
        // список вопросов, только с другого конца. Новые оценки realtime
        // приносит исправно, а вот исчезновение строк — нет: у answer_log
        // нет replica identity full (см. 001_schema), поэтому в событии
        // DELETE приезжает один первичный ключ, и серверный фильтр
        // `game_id=eq.<id>` его отбрасывает. «Сброс игры» и повторный
        // импорт стирают журнал каскадом вместе с вопросами — узнать об
        // этом можно только перечиткой, и вот она.
        Quiz.store.gameAnswerLog = await Quiz.db.getGameAnswerLog(game.id);

        await this.reloadRevealedAnswer();
    },

    reloadRevealedAnswer: async function () {
        var game = Quiz.store.game;
        if (!game || !game.current_question_id) {
            Quiz.store.revealedAnswer = null;
            return;
        }
        Quiz.store.revealedAnswer =
            await Quiz.db.getRevealedAnswer(game.current_question_id);
    },

    // --- Мелочи ----------------------------------------------------------

    /** Заменяет строку с тем же id или дописывает новую. */
    upsert: function (list, row) {
        var replaced = false;
        var next = list.map(function (item) {
            if (item.id !== row.id) return item;
            replaced = true;
            return row;
        });
        if (!replaced) next.push(row);
        return next;
    },

    playJingleFor: function (participantId) {
        var participant = Quiz.store.participants.find(function (p) {
            return p.id === participantId;
        });
        Quiz.audio.play(participant && participant.sound_key);
    }
};
