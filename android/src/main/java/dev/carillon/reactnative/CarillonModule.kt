package dev.carillon.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import dev.carillon.sdk.Carillon
import dev.carillon.sdk.OpenedNotification
import dev.carillon.sdk.TagValue
import dev.carillon.sdk.tagOf
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android half of the bridge.
 *
 * It translates and forwards, and does nothing else. Registration, the retry
 * policy, the event queue, the open held across a cold start all live in
 * `dev.carillon.sdk`; a behaviour that existed only here would be a behaviour
 * the Kotlin SDK's own tests could never see.
 */
class CarillonModule(private val context: ReactApplicationContext) :
  NativeCarillonSpec(context) {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private var observing = false

  override fun configure(key: String, endpoint: String?, debug: Boolean?) {
    // The defaults belong to the SDK, which is the only place they are written
    // down. Passing its own constant back to it keeps it that way.
    Carillon.configure(
      context = context,
      key = key,
      endpoint = endpoint ?: Carillon.DEFAULT_ENDPOINT,
      debug = debug ?: false,
    )
  }

  override fun requestPermission(promise: Promise) {
    // Android needs an activity to raise the dialogue and iOS needs nothing, so
    // the activity is found here rather than asked of JavaScript: a React Native
    // app has no business holding one, and the promise is the same on both
    // platforms because of it.
    val activity = context.currentActivity

    if (activity == null) {
      // No activity means no screen for a dialogue to belong to — a request
      // made while the app is in the background, which the OS would refuse
      // anyway. Rejected rather than answered, because the alternative is
      // reporting a decision nobody was given the chance to make.
      promise.reject(NO_ACTIVITY, "No activity is in the foreground to show the prompt on.")

      return
    }

    // `requestPermission()` suspends until the person has answered. The state is
    // lowercased into the word the protocol uses, which is the same word the iOS
    // side answers with.
    scope.launch {
      promise.resolve(Carillon.requestPermission(activity).name.lowercase(Locale.US))
    }
  }

  override fun identify(externalId: String) = Carillon.identify(externalId)

  override fun clearIdentity() = Carillon.clearIdentity()

  override fun setTags(tags: ReadableMap) = Carillon.setTags(tagsOf(tags))

  override fun optIn() = Carillon.optIn()

  override fun optOut() = Carillon.optOut()

  override fun debugInfo(promise: Promise) {
    // The SDK's own serialisation, re-read rather than rebuilt: the field names
    // in a support ticket and the field names here cannot drift apart if only
    // one side ever writes them.
    promise.resolve(readableOf(JSONObject(Carillon.debugInfo().toJson())))
  }

  override fun startObservingOpens() {
    if (observing) return

    observing = true
    // Installing the handler is what makes the SDK release the tap it has been
    // holding since launch, so this happens when JavaScript asks for it rather
    // than when this module is constructed — by which time nobody is listening.
    Carillon.onOpened = { opened -> emitOnOpened(openedOf(opened)) }
  }

  override fun invalidate() {
    Carillon.onOpened = null
    observing = false
    scope.cancel()
    super.invalidate()
  }

  private fun openedOf(opened: OpenedNotification): WritableMap {
    val payload = Arguments.createMap()
    // The data map as FCM delivered it, untouched. The reserved `carillon`
    // entry is a JSON string on this platform and an object on iOS, because
    // that is what each transport carries; `deliveryId` is here so that no app
    // has to know the difference.
    opened.data.forEach { (name, value) -> payload.putString(name, value) }

    return Arguments.createMap().apply {
      putString("deliveryId", opened.deliveryId)
      putString("openedAt", ISO_8601.get()!!.format(Date(opened.openedAtMs)))
      putMap("payload", payload)
    }
  }

  /**
   * A JavaScript object, as the SDK's sealed tag type.
   *
   * Anything that is not a flat scalar is dropped rather than refused: the
   * TypeScript surface is where a tag's shape is rejected, and it is rejected
   * there before the call is written rather than after it has shipped.
   */
  private fun tagsOf(tags: ReadableMap): Map<String, TagValue> {
    val result = LinkedHashMap<String, TagValue>()
    val names = tags.keySetIterator()

    while (names.hasNextKey()) {
      val name = names.nextKey()

      when (tags.getType(name)) {
        ReadableType.String -> tags.getString(name)?.let { result[name] = tagOf(it) }
        ReadableType.Boolean -> result[name] = tagOf(tags.getBoolean(name))
        ReadableType.Number -> {
          // A whole number arrives from JavaScript as a double and would
          // otherwise be sent as `12.0`. The SDK draws the same distinction
          // when it restores a stored map; drawing it here means a tag survives
          // a round trip looking like what the customer wrote.
          val value = tags.getDouble(name)
          result[name] =
            if (value == Math.floor(value) && !value.isInfinite()) tagOf(value.toLong())
            else tagOf(value)
        }
        else -> Unit
      }
    }

    return result
  }

  private fun readableOf(json: JSONObject): WritableMap {
    val map = Arguments.createMap()

    json.keys().forEach { name ->
      when (val value = json.get(name)) {
        JSONObject.NULL -> map.putNull(name)
        is Boolean -> map.putBoolean(name, value)
        is Int -> map.putInt(name, value)
        is Long -> map.putDouble(name, value.toDouble())
        is Double -> map.putDouble(name, value)
        is JSONObject -> map.putMap(name, readableOf(value))
        is JSONArray -> map.putString(name, value.toString())
        else -> map.putString(name, value.toString())
      }
    }

    return map
  }

  private companion object {
    const val NO_ACTIVITY = "carillon_no_activity"

    /**
     * The instant of a tap, as JavaScript will read it. The same shape the SDK
     * writes into a request body, spelled out again because it is internal
     * there — a bridge may repeat a format, never a rule.
     */
    val ISO_8601: ThreadLocal<SimpleDateFormat> =
      ThreadLocal.withInitial {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
        }
      }
  }
}
