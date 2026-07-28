/**
 * Разбор файла с вопросами (.xlsx).
 *
 * Раскладка столбцов оставлена как в старой версии, чтобы уже собранные
 * файлы продолжали работать:  A = вопрос | B = ответ | C = картинка
 * вопроса | D = картинка ответа. Первая непустая строка — заголовок, она
 * пропускается.
 *
 * Этот файл только читает и проверяет. Записью занимается
 * Quiz.db.replaceQuestions — имена таблиц живут там и больше нигде, а
 * половинка с ответом уходит в отдельную таблицу question_answer, см.
 * комментарий в sql/001_schema.sql. Порядок «разобрать, потом писать»
 * важен: из битого файла в базу не должно попасть ничего, в том числе
 * половины.
 */
Quiz.excel = {
    /**
     * Причины отказа, которые интерфейс обязан различать: человеку в
     * каждом случае надо делать разное. Тексты — в Quiz.ui.admin.MESSAGES.
     */
    FAIL_LIBRARY: 'library',
    FAIL_FORMAT:  'format',
    FAIL_EMPTY:   'empty',

    /** Что считаем книгой Excel. Ровно то, что предлагает выбрать кнопка. */
    EXTENSIONS: ['.xlsx', '.xls', '.xlsm'],

    /** Ошибка с полем `reason` — интерфейс смотрит на него, не на текст. */
    fail: function (reason, message) {
        var err = new Error(message || reason);
        err.reason = reason;
        return err;
    },

    /**
     * Похоже ли это вообще на книгу Excel — по имени файла.
     *
     * Судить по содержимому не выйдет: XLSX.read почти никогда не падает.
     * Текстовый файл он молча перечитывает как CSV и отдаёт лист «Sheet1»
     * с одной строкой мусора, а нулевой файл — пустой лист. То есть без
     * этой проверки человек, выбравший заметку вместо таблицы, получил бы
     * «в файле нет строк с вопросами» и пошёл искать вопросы в пустом
     * файле вместо того, чтобы взять другой.
     */
    looksLikeWorkbook: function (name) {
        var lower = String(name || '').toLowerCase();
        return this.EXTENSIONS.some(function (ext) {
            return lower.slice(-ext.length) === ext;
        });
    },

    /**
     * File -> [{ text, imageUrl, answerText, answerImageUrl }].
     *
     * Бросает ошибку с `reason`, ничего не пишет и ничего не показывает.
     */
    parse: async function (file) {
        // Библиотека приезжает с CDN. Без сети её нет, и это не «файл
        // битый» — чинить надо совсем другое.
        if (!window.XLSX) {
            throw this.fail(this.FAIL_LIBRARY, 'XLSX не загрузился с CDN');
        }
        if (!this.looksLikeWorkbook(file.name)) {
            throw this.fail(this.FAIL_FORMAT, 'не книга Excel: ' + file.name);
        }

        var rows;
        try {
            var buffer = await file.arrayBuffer();
            var book = XLSX.read(new Uint8Array(buffer), { type: 'array' });
            var sheet = book.Sheets[book.SheetNames[0]];
            // header: 1 отдаёт строки массивами, а не объектами по
            // заголовку. Заголовки в этих файлах бывают какие угодно, и
            // опираться на них нельзя — только на порядок столбцов.
            rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch (err) {
            throw this.fail(this.FAIL_FORMAT, err.message);
        }

        var filled = rows.filter(this.hasAnything);

        // Пустые строки выброшены ДО отсечения заголовка — как и в старой
        // версии. Иначе пустая первая строка съела бы первый вопрос.
        if (filled.length <= 1) {
            throw this.fail(this.FAIL_EMPTY, 'строк с данными нет');
        }

        var self = this;
        return filled.slice(1).map(function (row) {
            return {
                text:           self.cell(row[0]),
                answerText:     self.cell(row[1]),
                imageUrl:       self.link(row[2]),
                answerImageUrl: self.link(row[3])
            };
        });
    },

    /**
     * Строка считается пустой, когда пусты все её ячейки.
     *
     * Одни пробелы — тоже пусто. Здесь мы расходимся со старой версией
     * намеренно: та сравнивала с '' и пропускала такую строку дальше, а
     * ведущий получал посреди игры вопрос без текста. Файлы, в которых
     * таких строк нет, от этого не меняются.
     */
    hasAnything: function (row) {
        return !!row && row.some(function (cell) {
            return cell != null && String(cell).trim() !== '';
        });
    },

    cell: function (value) {
        return value == null ? '' : String(value).trim();
    },

    /**
     * Ячейка с картинкой — только если это похоже на ссылку.
     *
     * В этих столбцах регулярно оказываются заметки вроде «нет» или
     * «поискать». Подставить такое в src значит получить пустой квадрат с
     * запросом в никуда, поэтому всё, что не начинается с http, считается
     * пустой ячейкой.
     */
    link: function (value) {
        var text = this.cell(value);
        return text.indexOf('http') === 0 ? text : null;
    }
};
