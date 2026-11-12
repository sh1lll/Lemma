package app.lemma.mobile;

import android.content.Intent;

/** Quick Settings tile "Lemma Voice": opens the calculator and starts listening (?listen=1). */
public class VoiceTileService extends LemmaTileService {

    @Override
    protected Intent launchIntent() {
        return LemmaLaunch.voiceIntent(this);
    }

    @Override
    protected int requestCode() {
        return 102;
    }

    @Override
    protected int subtitleRes() {
        return R.string.tile_voice_subtitle;
    }
}
