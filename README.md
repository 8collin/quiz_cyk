# Quiz

Buzzer quiz for a live audience. One page, two roles: the host drives the
questions from a laptop, players buzz in from their phones. State is shared
through Supabase Realtime.

Rewritten from scratch. The previous version lives in
[damenweb/quiz](https://github.com/damenweb/quiz) as a single 1300-line
`cyk.html`; it is kept only as a reference for the game mechanics.

## Constraints

This project is edited on a machine with no Node.js and no toolchain, so:

- **No build step.** No TypeScript, no bundler, no npm.
- **Classic `<script>` tags, not ES modules.** `index.html` has to open by
  double-clicking it, and browsers block ES modules over `file://`.
  Consequently the load order in `index.html` is significant, and files
  communicate through the single global `Quiz` object.
- Third-party code comes from a CDN.

Please keep any contribution inside these limits.

## Layout

```
index.html        entry point; the script order at the bottom matters
css/
  tokens.css      colours, radii — nothing else hard-codes them
  base.css        reset, shared shell, the .role-* switch
  admin.css       host view (desktop)
  player.css      player view (phone)
js/
  namespace.js    the global Quiz object
  config.js       Supabase URL + anon key           <- fill this in
  dom.js          small DOM helpers
  db.js           Supabase client and every query
  store.js        in-memory mirror of the game
  timing.js       server clock and the T axis
  audio.js        jingles and the volume slider
  auth.js         sign in / sign out
  excel.js        question import from .xlsx
  game.js         host actions
  buzzer.js       the player's only write
  realtime.js     subscriptions
  ui/             rendering, one file per region
  main.js         startup, loaded last
sql/
  001_schema.sql  tables
  002_functions.sql functions and triggers
  003_rls.sql     row level security
audio/            jingles, <sound_key>.mp3
```

## Setup

1. Create a Supabase project.
2. In **SQL Editor**, run `sql/001_schema.sql`, `sql/002_functions.sql`
   and `sql/003_rls.sql`, in that order.
3. Copy the project URL and the **anon** key into `js/config.js`. The anon
   key is public by design — it ships inside the page. Access is controlled
   by the RLS policies, not by hiding it. Never put the `service_role` key
   in this repository.
4. Create the host account under **Authentication → Users**, then promote it:

   ```sql
   update public.profile set role = 'admin' where id = '<user-uuid>';
   ```

5. Open `index.html`.

## Two things worth knowing before changing the rules

**The buzzer race is decided by the database.** Every player INSERTs into
`buzz`; the unique index `buzz_one_per_game` lets exactly one through and
the rest get `23505`. Do not try to pick a winner on the client.

**Cooldowns run on the T axis, not on the clock.** T advances only while
nobody is answering and freezes while someone holds the buzzer, so a
penalty cannot expire during a long answer. The formula is in
`public.think_now()` and mirrored in `js/timing.js` — change one and you
must change the other.

## Status

Skeleton. The schema, the layout and the foundation modules are in place;
game logic is stubbed and marked with `TODO(skeleton)`.
