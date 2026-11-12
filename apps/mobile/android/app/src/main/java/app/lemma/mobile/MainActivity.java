package app.lemma.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** True when the activity is being recreated (rotation, process death). */
    private boolean restoredFromState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        restoredFromState = savedInstanceState != null;
        super.onCreate(savedInstanceState);
    }

    /**
     * Called for relaunches of the singleTask activity, and also by
     * BridgeActivity.load() with getIntent() right after the bridge has
     * started loading the app on a cold start, so both paths land here.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null) return;

        // Don't re-run the original query when the activity is merely recreated,
        // or when the user reopens the task from Recents.
        if (restoredFromState && intent == getIntent()) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;

        LemmaLaunch.Request request = LemmaLaunch.parse(intent);
        if (request != null) openInWebView(request);
    }

    private void openInWebView(LemmaLaunch.Request request) {
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        String appUrl = bridge.getAppUrl();
        if (webView == null || appUrl == null) return;
        // The web app reads ?q= / ?listen=1 once at startup (apps/web/src/main.ts),
        // so (re)load the app URL with them. On a cold start this supersedes the
        // bridge's initial loadUrl(appUrl) before it commits.
        webView.loadUrl(LemmaLaunch.buildWebUrl(appUrl, request));
    }
}
