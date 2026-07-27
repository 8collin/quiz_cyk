/**
 * The player list — scoreboard for players, control panel for the host.
 *
 * Two things to get right:
 *
 *  - Build rows with createElement/textContent, not by concatenating HTML.
 *    Player names are user input; the old version interpolated them into a
 *    template string, so a quote in a name broke the markup.
 *  - Players see the list sorted by score, the host sees it sorted by name
 *    (a list that reorders itself mid-round is unusable to score from).
 *
 * TODO(skeleton): implement render(), plus the host's per-row controls
 * (−1 / 0 / +1, −⏳, remove) and the ⭐ / ⏳ badges.
 */
Quiz.ui = Quiz.ui || {};
Quiz.ui.players = {};
