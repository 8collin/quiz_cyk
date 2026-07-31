# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A live buzzer quiz. One HTML page serves two roles: the host runs the
questions from a laptop, players buzz in from their phones. There is no
server of ours — the browser talks straight to Supabase (Postgres +
Realtime), and the database is where the rules are enforced.

This is a from-scratch rewrite. The previous version was a single
1300-line `cyk.html` in `damenweb/quiz`, kept only as a reference for game
mechanics. Do not copy its structure; do consult it when a rule is unclear.

Current state: complete and verified on live sessions — schema, login,
realtime, the buzzer, the host panel, the Excel import and account
creation. `TODO.md` lists what is genuinely left, including the checks only
a human can run: real phones, a real question file, and opening
`index.html` from disk.

Read `docs/decisions.md` before changing anything that looks arbitrary.
It records why each of those choices is the way it is — the order of two
requests, a class deliberately missing from the markup — and most of those
entries were paid for with a bug that already happened once.

## Hard constraints — do not violate these

The machine this project will be developed on has **no Node.js and no
toolchain**. The current machine happens to have both, but the project
must never come to depend on them, so "let's just add Vite" is never an
acceptable suggestion.

Tooling that stays outside the shipped page is fine to use here and now —
a syntax check, an MCP server talking to Supabase. The test is whether
the repository still works after it is taken away.

- **No build step.** No TypeScript, no bundler, no npm, no transpilation.
- **Classic `<script src>` tags, never ES modules.** `index.html` must
  open by double-clicking it from disk, and browsers block ES modules over
  `file://` (CORS). Therefore:
  - the script order at the bottom of `index.html` is significant;
  - files communicate through the single global `Quiz` object;
  - a file may only use pieces that `index.html` loads *before* it.
- Third-party code comes from a CDN, as a classic script exposing a global.
- Plain ES5-style syntax in the shared object literals (`var`, `function`).
  `async`/`await` is fine — every target browser supports it.

Before proposing anything, check it still works when the page is opened
from the filesystem with no server running.

## Language convention

**Code comments and documentation are written in Russian.** This includes
JSDoc blocks, inline comments, SQL comments, `README.md`, `TODO.md` and
anything under `docs/`. Commit messages are in English.

This file (`CLAUDE.md`) is written in English because it addresses the
agent, not the human maintainer.

Identifiers, table and column names, CSS classes and element ids stay in
English. UI strings are in Russian, since that is the audience.

## Architecture

```
index.html   entry point; the script order at the bottom matters
css/         tokens.css → base.css → admin.css → player.css
js/          foundation first, then features, main.js last
js/ui/       rendering, one file per region of the screen
sql/         numbered migrations, applied in ascending order
docs/        prose that outgrew a comment; Russian, like the rest
```

One markup, two applications: the role is a class on `<body>`
(`role-admin` / `role-player`), and everything else is CSS. Do not build a
second page for the player view.

`js/db.js` is the only file allowed to name a table or a column. Anything
above it works with objects, not query strings.

`js/store.js` is the in-memory mirror of the game. Only realtime handlers
and explicit reloads write to it; the UI only reads. Keeping that one-way
street is what stops the "who is answering" highlight from disagreeing
with the buzzer.

## Invariants worth protecting

These were expensive to get right. Changing them needs a deliberate
decision, not a refactor in passing.

**The buzzer race is settled by the database.** Every player INSERTs into
`buzz`; the unique index `buzz_one_per_game` lets exactly one through and
the rest get `23505`. Never try to pick a winner on the client — clock
skew and latency make that unwinnable.

**Cooldowns advance along the T axis, not the wall clock.** T moves only
while nobody is answering and freezes while someone holds the buzzer, so a
penalty cannot expire during a long answer. The formula lives in
`public.think_now()` and is mirrored in `js/timing.js`. Change one and you
must change the other.

**Never trust the device clock.** Phones drift by minutes. `Quiz.timing`
measures the offset against `server_now()` once and corrects for it
everywhere.

**The countdown must not query the database on a tick.** It repaints five
times a second off cached state; realtime corrects that state. Ten phones
polling would be thousands of pointless requests per round.

**The anon key is public and grants nothing.** It ships inside the page.
Access control lives entirely in the RLS policies in `sql/003_rls.sql`.
Never add the `service_role` key to this repository, and never move a rule
from a policy into client code.

**Answers live in their own table.** RLS is row-level, not column-level:
anything a player may SELECT, they may SELECT entirely. Keeping the answer
in the question row would leak it through devtools before the reveal —
which the previous version did. `question_answer` is readable to a player
only while it is the current question and `show_answer` is set.

**`security definer` functions bypass RLS**, so any of them that a client
can call must check `is_admin()` in its own body.

**Two functions write straight into `auth.users`** — `admin_set_password`
and `admin_delete_user` in `sql/006_users.sql`. That is not a supported
Supabase path; it exists because changing another person's password needs
the `service_role` key, which this repository may not hold. Keep the list
at two, and read the header there before adding a third.

**A person's name and their login are different columns.**
`profile.display_name` is free to change and is mirrored into
`participant` by a trigger; `profile.login` mirrors `auth.users.email`,
is what they type to sign in, and is frozen by `guard_profile_role`. The
address is derived from the name only once, at signup — after the first
rename the two no longer agree, which is why the panel shows both.

**A player's jingle belongs to the person, not the game.**
`profile.sound_key` is the source of truth; it is mirrored into
`participant.sound_key` by a trigger (across every game) and copied by
`join_game` on entry — the same mechanism as `display_name`, and for the
same reason: the buzzer reads the key from `participant` on every device
because `profile` is not in the realtime publication, so the hot path must
never touch `profile`. `guard_profile_role` freezes `sound_key` for
non-admins, so the host hands out jingles and a player cannot reassign their
own. The sounds panel therefore assigns by account, not by participant. See
`sql/007_sound_global.sql`.

**A Storage object name is not a free-form string.** The `sounds` bucket
rejects anything outside a narrow ASCII set, and the keys this game uses
are player names — `Алина.mp3` comes back as `Invalid key`. Paths are
generated per upload (`Quiz.ui.sounds.freshPath`), never derived from the
key. That also dodges the public bucket's `max-age=3600`, which would
otherwise keep serving a replaced file for an hour.

**Supabase runs with `pg_safeupdate`**: `UPDATE` and `DELETE` without a
`WHERE` clause are rejected at runtime. Always include one.

## Rendering

Build DOM with `createElement` / `textContent`, never by concatenating
HTML strings. Player names are user input, and the previous version
interpolated them into template literals — a quote in a name broke the
markup.

## Verifying a change

There is no test suite. What you can do:

- `node --check <file>` for JS syntax.
- Load the page and read the console — see the setup below.
- Run SQL through the Supabase MCP server, or paste it into the SQL Editor.
  `.mcp.json` scopes that server to this project's ref and reads
  `SUPABASE_ACCESS_TOKEN` from the environment, so no secret is in the
  repository. It connects as `postgres` and therefore **bypasses RLS** —
  to test a policy, impersonate a role instead:

  ```sql
  begin;
  select set_config('request.jwt.claims',
                    '{"sub":"<user uuid>","role":"authenticated"}', true);
  set local role authenticated;
  -- запрос, который проверяем
  rollback;
  ```

  Remember that an `UPDATE` a policy rejects raises nothing — it changes
  zero rows. Only `INSERT` comes back as `42501`.

Do not claim a change works if you have not actually loaded the page.

### Driving the page yourself

`file://` will not do: the preview pane serves a frozen snapshot of it and
never re-reads from disk. Serve the folder instead — `.claude/launch.json`
defines a `quiz` configuration that runs `python -m http.server 8000`.

Roles need **different origins**, or they share `localStorage` and thus one
session. Port is part of the origin, so `launch.json` defines one server
per role: 8000 host, 8123 player one, 8001 player two.

Do not reach for `127.0.0.1` as a second origin. It looks equivalent to
`localhost` and is not: the Unreal Editor binds `127.0.0.1:8000`
specifically, and a specific binding beats the `::`/`0.0.0.0` one, so the
page silently comes back as an Epic Games error payload.

Signing in: the dev credentials live in `js/dev.local.js`, kept outside git
(`.gitignore` catches `*.local.js`). It declares nothing but data:

```js
window.QuizDevAccounts = { admin: { email, password }, player1: {...} };
```

Nothing in `index.html` references it. Reading it and signing in as any of
these accounts is fine. The tidy way is to load it into an already-open
page and sign in through the object rather than pasting literals:

```js
const acc = window.QuizDevAccounts.admin;
const profile = await Quiz.auth.signIn(acc.email, acc.password);
await Quiz.main.enterGame(profile);
```

If a login is rejected, the file may be stale — the maintainer sometimes
changes a password in the dashboard.

The session survives in `localStorage`, so this is needed once per origin —
until someone signs out or the token expires.

**Silence a new origin as soon as you open it** — `Quiz.audio.setVolume(0)`.
Jingles from these tabs play out of the maintainer's speakers, and volume
is stored per origin, so every new port starts at full again. This hides
nothing: `play()` is still called, so a blocked autoplay still surfaces,
and which jingle fired is best checked by spying on `Quiz.audio.play`
anyway.

**The console reader prints every message twice.** One `console.log` comes
back as two identical lines. It is the reading layer, not the page: a
single call with a unique timestamp appears twice with the same timestamp,
and a marker logged in one tab never shows up in another, so tabs are not
being mixed either. Trust the content, never the count — to prove a
handler ran exactly once, keep a counter in the page and read the variable.

Two things this setup does **not** cover, and they still need a human:
opening `index.html` from disk (the whole reason ES modules are banned),
and the player layout on a real phone.
