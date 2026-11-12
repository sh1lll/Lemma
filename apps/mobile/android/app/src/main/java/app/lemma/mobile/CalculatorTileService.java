package app.lemma.mobile;

import android.content.Intent;

/** Quick Settings tile "Lemma": opens the calculator. */
public class CalculatorTileService extends LemmaTileService {

    @Override
    protected Intent launchIntent() {
        return LemmaLaunch.calculatorIntent(this);
    }

    @Override
    protected int requestCode() {
        return 101;
    }

    @Override
    protected int subtitleRes() {
        return R.string.tile_calculator_subtitle;
    }
}
