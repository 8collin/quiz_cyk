/**
 * Import questions from an .xlsx file.
 *
 * Column layout, unchanged from the old version so existing files keep
 * working:  A = вопрос | B = ответ | C = картинка вопроса | D = картинка
 * ответа. The first row is a header and is skipped.
 *
 * TODO(skeleton): implement
 *   parse(file)              — File -> [{ text, imageUrl, answerText,
 *                              answerImageUrl }], header row dropped,
 *                              blank rows dropped, non-http image cells
 *                              treated as empty
 *   importInto(gameId, rows) — replace this game's questions in one go
 *
 * Note: unlike the old code, the answer halves go to `question_answer`,
 * not into the question row — see the comment in sql/001_schema.sql.
 */
Quiz.excel = {};
