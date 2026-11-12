package app.lemma.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen widget with "Calculate" and "Speak" buttons. */
public class LemmaWidgetProvider extends AppWidgetProvider {

    private static final int RC_CALCULATE = 201;
    private static final int RC_SPEAK = 202;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        PendingIntent calculate = activityIntent(context, LemmaLaunch.calculatorIntent(context), RC_CALCULATE);
        PendingIntent speak = activityIntent(context, LemmaLaunch.voiceIntent(context), RC_SPEAK);

        for (int appWidgetId : appWidgetIds) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.lemma_widget);
            views.setOnClickPendingIntent(R.id.widget_brand, calculate);
            views.setOnClickPendingIntent(R.id.widget_calculate, calculate);
            views.setOnClickPendingIntent(R.id.widget_speak, speak);
            appWidgetManager.updateAppWidget(appWidgetId, views);
        }
    }

    private static PendingIntent activityIntent(Context context, Intent intent, int requestCode) {
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }
}
