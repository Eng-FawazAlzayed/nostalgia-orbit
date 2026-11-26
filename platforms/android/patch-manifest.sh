#!/usr/bin/env bash
# Make the APK show up on Android TV / Google TV launchers and work with a remote.
set -euo pipefail
M=android/app/src/main/AndroidManifest.xml
grep -q leanback "$M" || sed -i 's#<application#<uses-feature android:name="android.software.leanback" android:required="false" />\n    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n    <application android:banner="@drawable/banner"#' "$M"
grep -q LEANBACK_LAUNCHER "$M" || sed -i 's#<category android:name="android.intent.category.LAUNCHER" />#<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />#' "$M"
# landscape TV app, keep hardware acceleration on
sed -i 's#android:name=".MainActivity"#android:name=".MainActivity" android:screenOrientation="sensorLandscape" android:hardwareAccelerated="true"#' "$M"
mkdir -p android/app/src/main/res/drawable
cp ../../assets/banner-320x180.png android/app/src/main/res/drawable/banner.png
# keep the screen on while watching
MA=$(find android/app/src/main/java -name MainActivity.java | head -1)
if [ -n "$MA" ] && ! grep -q KEEP_SCREEN_ON "$MA"; then
  cat > "$MA" <<'JAVA'
package tv.nostalgiaorbit.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
}
JAVA
fi
echo "manifest patched"
