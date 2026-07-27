/**
 * Entry point. Loaded last, wires everything together and starts the app.
 *
 * TODO(skeleton): implement
 *   1. Quiz.db.init()
 *   2. Quiz.audio.load() and bind the volume slider
 *   3. Quiz.auth.restoreSession(); no session -> show the login screen
 *   4. On sign-in: set the body role class, load the game, questions,
 *      participants, buzz and answer log, then Quiz.realtime.subscribe()
 *   5. Bind the host controls and the buzzer
 *
 * Order matters at step 4: Quiz.timing.syncClock() has to run before
 * anything paints a countdown, or the first repaint uses the device clock.
 */
window.addEventListener('DOMContentLoaded', function () {
    console.log('Quiz', Quiz.VERSION, '— скелет, логика ещё не подключена');
});
