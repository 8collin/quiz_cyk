/**
 * Sign in / sign out on top of Supabase Auth.
 *
 * Passwords are never seen, stored or compared by this code — that is the
 * whole point of moving off the old `select * from quiz_users where
 * login=? and password=?`, which kept them in plain text and let anyone
 * with the anon key read the table.
 *
 * TODO(skeleton): implement
 *   signIn(email, password) — supabase.auth.signInWithPassword, then load
 *                             the profile row and hand it to Quiz.store
 *   signOut()               — supabase.auth.signOut + Quiz.store.reset
 *   restoreSession()        — supabase.auth.getSession on startup; the SDK
 *                             already persists it in localStorage, so a
 *                             reload should not ask for the password again
 *   onAuthChange(cb)        — react to token refresh / expiry
 */
Quiz.auth = {};
