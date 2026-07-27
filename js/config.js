/**
 * Deployment-specific settings.
 *
 * The anon key is meant to be public — it ships inside the page and anyone
 * can read it. It is NOT a secret and it is NOT what keeps players from
 * editing their own score; that job belongs to the RLS policies in
 * sql/003_rls.sql. Never put the service_role key here.
 */
Quiz.config = {
    SUPABASE_URL: 'PASTE_YOUR_SUPABASE_URL_HERE',
    SUPABASE_ANON_KEY: 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE',

    /** Folder with jingles, relative to index.html. */
    AUDIO_PATH: 'audio/',

    /** Played when a player has no sound_key, or their file is missing. */
    DEFAULT_SOUND: 'default',

    /** Played on the host's "🎵" button, broadcast to every device. */
    INTRO_SOUND: 'intro',

    /** How often the buzzer countdown repaints, ms. Purely local, no queries. */
    COUNTDOWN_TICK_MS: 200
};
