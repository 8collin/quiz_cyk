/**
 * Вход и выход поверх Supabase Auth.
 *
 * Пароли этот код не видит, не хранит и не сравнивает — ради этого и был
 * оставлен старый `select * from quiz_users where login=? and password=?`,
 * который держал их открытым текстом и позволял прочитать таблицу любому,
 * у кого есть anon-ключ.
 *
 * TODO(скелет): реализовать
 *   signIn(email, password) — supabase.auth.signInWithPassword, затем
 *                             загрузить строку profile и положить в Quiz.store
 *   signOut()               — supabase.auth.signOut + Quiz.store.reset
 *   restoreSession()        — supabase.auth.getSession при старте; SDK сам
 *                             хранит сессию в localStorage, поэтому после
 *                             перезагрузки пароль спрашивать заново не нужно
 *   onAuthChange(cb)        — реакция на обновление и истечение токена
 */
Quiz.auth = {};
