package app.lemma.mobile;

import android.app.SearchManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * Single place that knows how Lemma is launched from outside the WebView
 * (Quick Settings tiles, the home-screen widget, app shortcuts, Assistant
 * capabilities, the text-selection menu and the share sheet) and how such a
 * launch maps onto the web app's URL parameters (?q=... / ?listen=1).
 */
public final class LemmaLaunch {

    /** Custom deep-link scheme: lemma://calculate?q=2%2B2, lemma://listen */
    public static final String SCHEME = "lemma";
    public static final String HOST_CALCULATE = "calculate";
    public static final String HOST_LISTEN = "listen";

    /** Extra used by shortcuts.xml capabilities (GET_THING / custom CALCULATE) and by callers. */
    public static final String EXTRA_QUERY = "q";
    /** Boolean extra; equivalent to lemma://listen. */
    public static final String EXTRA_LISTEN = "listen";
    /** OPEN_APP_FEATURE passes the matched shortcut id here. */
    public static final String EXTRA_FEATURE = "feature";
    /** Shortcut id of the voice shortcut (also used as an OPEN_APP_FEATURE inventory id). */
    public static final String FEATURE_VOICE = "voice";

    /** The web app slices the input to 500 chars; do the same so URLs stay sane. */
    static final int MAX_QUERY_LENGTH = 500;

    private LemmaLaunch() {}

    /** Explicit intent that just opens the calculator. */
    public static Intent calculatorIntent(Context context) {
        return viewIntent(context, new Uri.Builder().scheme(SCHEME).authority(HOST_CALCULATE).build());
    }

    /** Explicit intent that opens the calculator and starts voice input. */
    public static Intent voiceIntent(Context context) {
        return viewIntent(context, new Uri.Builder().scheme(SCHEME).authority(HOST_LISTEN).build());
    }

    /** Explicit intent that opens the calculator and runs {@code query}. */
    public static Intent queryIntent(Context context, String query) {
        return viewIntent(
            context,
            new Uri.Builder().scheme(SCHEME).authority(HOST_CALCULATE).appendQueryParameter(EXTRA_QUERY, query).build()
        );
    }

    private static Intent viewIntent(Context context, Uri data) {
        // Distinct data URIs keep the PendingIntents of the tile/widget buttons distinct.
        return new Intent(Intent.ACTION_VIEW, data, context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    /** What the web view should do for a launch intent. */
    public static final class Request {

        public final String query; // may be null
        public final boolean listen;

        Request(String query, boolean listen) {
            this.query = query;
            this.listen = listen;
        }
    }

    /**
     * Parses any intent MainActivity can receive. Returns null when the intent
     * carries no query and no listen flag (plain launcher start, "Calculate"
     * shortcut/tile/widget button), in which case the app is simply shown.
     */
    public static Request parse(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        String query = null;
        boolean listen = false;

        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            // Text-selection menu ("Lemma" next to Copy / Share).
            query = asString(intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT));
        } else if (Intent.ACTION_SEND.equals(action)) {
            // Share sheet, text/plain only (images are not registered; see AndroidManifest.xml).
            query = asString(intent.getCharSequenceExtra(Intent.EXTRA_TEXT));
        } else {
            Uri data = intent.getData();
            if (data != null && SCHEME.equalsIgnoreCase(data.getScheme()) && data.isHierarchical()) {
                query = data.getQueryParameter(EXTRA_QUERY);
                listen = HOST_LISTEN.equalsIgnoreCase(data.getHost()) || data.getQueryParameter(EXTRA_LISTEN) != null;
            }
            if (query == null) {
                // App Actions capabilities (shortcuts.xml) put the parameter in extra "q".
                query = asString(intent.getCharSequenceExtra(EXTRA_QUERY));
            }
            if (query == null) {
                // Google "search in app" voice action: com.google.android.gms.actions.SEARCH_ACTION.
                query = asString(intent.getCharSequenceExtra(SearchManager.QUERY));
            }
            if (!listen) {
                listen = intent.getBooleanExtra(EXTRA_LISTEN, false) ||
                    FEATURE_VOICE.equalsIgnoreCase(asString(intent.getCharSequenceExtra(EXTRA_FEATURE)));
            }
        }

        query = clean(query);
        if (query == null && !listen) return null;
        return new Request(query, listen);
    }

    /** Builds the web app URL: {@code appUrl} with ?q= and/or ?listen=1 replacing any query. */
    public static String buildWebUrl(String appUrl, Request request) {
        Uri.Builder builder = Uri.parse(appUrl).buildUpon().clearQuery().fragment(null);
        if (request.query != null) builder.appendQueryParameter(EXTRA_QUERY, request.query);
        if (request.listen) builder.appendQueryParameter(EXTRA_LISTEN, "1");
        return builder.build().toString();
    }

    private static String asString(CharSequence value) {
        return value == null ? null : value.toString();
    }

    private static String clean(String raw) {
        if (raw == null) return null;
        String s = raw.replaceAll("\\s+", " ").trim();
        if (s.isEmpty()) return null;
        if (s.length() > MAX_QUERY_LENGTH) {
            int end = MAX_QUERY_LENGTH;
            // Don't cut a surrogate pair in half.
            if (Character.isHighSurrogate(s.charAt(end - 1))) end--;
            s = s.substring(0, end);
        }
        return s;
    }
}
