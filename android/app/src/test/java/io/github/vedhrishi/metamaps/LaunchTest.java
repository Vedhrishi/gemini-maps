package io.github.vedhrishi.metamaps;

import static org.junit.Assert.*;
import android.os.Bundle;
import android.view.ViewGroup;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
public class LaunchTest {
    private void launch() {
        MainActivity a = Robolectric.buildActivity(MainActivity.class).create().start().resume().visible().get();
        ViewGroup content = a.findViewById(android.R.id.content);
        assertTrue(content.getChildCount() > 0);
        Robolectric.buildActivity(MainActivity.class).create().start().resume().pause().stop().destroy();
    }
    @Test @Config(sdk = 24) public void api24() { launch(); }
    @Test @Config(sdk = 28) public void api28() { launch(); }
    @Test @Config(sdk = 30) public void api30() { launch(); }
    @Test @Config(sdk = 33) public void api33() { launch(); }
    @Test @Config(sdk = 34) public void api34() { launch(); }
    @Test @Config(sdk = 35) public void api35() { launch(); }
}
