package dev.carillon.example

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import dev.carillon.sdk.Carillon

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "CarillonExample"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * The launching intent, in case this activity was started by a tap.
   *
   * Forwarded from the app's own code rather than installed behind its back —
   * the same explicitness the iOS side asks of an app delegate. The SDK holds
   * the open until JavaScript subscribes, which on a cold start is well after
   * this line has run.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Carillon.didOpen(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    Carillon.didOpen(intent)
  }
}
