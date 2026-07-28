/**
 * Таблица статистики.
 *
 * Показана она или нет, решает флаг show_stats в строке game, а не роль:
 * ведущий переключает, видят все разом. Поэтому здесь нет ни одной
 * проверки на isAdmin() — кнопки у игрока просто нет.
 *
 * Где именно она появляется — тоже не забота этого файла. Ведущему она
 * встаёт вместо вопроса, игроку ложится слоем поверх экрана, и обе
 * раскладки целиком в CSS (admin.css и player.css). Здесь только
 * «показать/спрятать» и строки.
 *
 * Строки собираются из Quiz.store.stats(), то есть из журнала оценок,
 * который realtime держит свежим сам. Никаких запросов на перерисовке:
 * пока таблица открыта, каждая выставленная ведущим оценка приезжает
 * событием и пересчитывает её у всех.
 *
 * Разметка строится через createElement/textContent. Имя игрока —
 * пользовательский ввод, и склейка HTML сломалась бы на первой же
 * кавычке в имени.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.stats = {
    render: function () {
        var game = Quiz.store.game;
        var open = !!(game && game.show_stats);

        Quiz.dom.toggle('stats-view', open);
        // Закрытую таблицу не пересобираем: строки всё равно никто не
        // видит, а перерисовка идёт на каждое событие игры.
        if (!open) return;

        var body = Quiz.dom.el('stats-body');
        body.textContent = '';
        Quiz.store.stats().forEach(function (row) {
            body.appendChild(Quiz.ui.stats.row(row));
        });
    },

    row: function (row) {
        var tr = document.createElement('tr');

        var name = document.createElement('td');
        name.className = 'stats-name';
        name.textContent = row.name;
        tr.appendChild(name);

        row.counts.forEach(function (count) {
            var td = document.createElement('td');
            // Ноль показываем прочерком: нужно видеть строку с оценками, а
            // столбик нулей её только прячет.
            td.textContent = count ? String(count) : '—';
            if (!count) td.className = 'is-empty';
            tr.appendChild(td);
        });

        var score = document.createElement('td');
        score.className = 'stats-score';
        score.textContent = String(row.score);
        tr.appendChild(score);

        return tr;
    }
};
