/**
 * Single global the whole application hangs off.
 *
 * There is no module system here: index.html loads plain <script> tags so
 * the page can be opened straight from disk, and ES modules are blocked by
 * CORS on file://. Every other file therefore starts with
 *
 *     Quiz.something = { ... };
 *
 * and may only reach for pieces that index.html loads *earlier* than it.
 * Keep that order in mind when adding a file.
 */
var Quiz = {
    /** Build marker, handy when a stale copy is open on someone's phone. */
    VERSION: '0.1.0-skeleton'
};
