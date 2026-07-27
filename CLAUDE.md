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

Current state: skeleton. Schema, layout and foundation modules exist; game
logic is stubbed and marked `TODO(скелет)`. See `TODO.md`.

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
sql/         001_schema → 002_functions → 003_rls, applied in that order
audio/       jingles, named <sound_key>.mp3
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

**Supabase runs with `pg_safeupdate`**: `UPDATE` and `DELETE` without a
`WHERE` clause are rejected at runtime. Always include one.

## Rendering

Build DOM with `createElement` / `textContent`, never by concatenating
HTML strings. Player names are user input, and the previous version
interpolated them into template literals — a quote in a name broke the
markup.

## Verifying a change

There is no test suite and no dev server. What you can do:

- `node --check <file>` for JS syntax, if Node happens to be available on
  the machine you are running on (it is not on the maintainer's).
- Open `index.html` from disk and read the browser console.
- SQL changes are verified by running the file in the Supabase SQL Editor.

Do not claim a change works if you have not actually loaded the page.
