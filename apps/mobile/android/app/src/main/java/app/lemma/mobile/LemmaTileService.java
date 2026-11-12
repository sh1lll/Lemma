package app.lemma.mobile;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Base Quick Settings tile that opens Lemma with a given intent. */
public abstract class LemmaTileService extends TileService {

    protected abstract Intent launchIntent();

    /** Distinct per tile so the PendingIntents never collide. */
    protected abstract int requestCode();

    protected abstract int subtitleRes();

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;
        // Action tile, not a toggle.
        tile.setState(Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(subtitleRes()));
        }
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (isLocked()) {
            unlockAndRun(this::launch);
        } else {
            launch();
        }
    }

    @SuppressWarnings("deprecation")
    private void launch() {
        Intent intent = launchIntent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+: startActivityAndCollapse(Intent) throws for apps targeting 34+.
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                requestCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
            startActivityAndCollapse(pendingIntent);
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
