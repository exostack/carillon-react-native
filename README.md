# @exostack/carillon-react-native

Carillon SDK for React Native, using the native [Swift][swift] and [Kotlin][kotlin]
SDKs. Requires a native build; Expo Go cannot load this module.

## Install

```sh
yarn add @exostack/carillon-react-native
```

Complete [native setup](#native-setup) or [Expo setup](#expo-setup), then rebuild
the app. Create an app in Carillon, upload its APNs or FCM credentials, and copy
a mobile key.

## Configure and use

```ts
import Carillon from '@exostack/carillon-react-native';

// Call once at app startup. Does not show a permission prompt.
Carillon.configure({ key: 'YOUR_MOBILE_KEY', debug: __DEV__ });

const permission = await Carillon.requestPermission();
// 'allowed' | 'denied' | 'provisional' | 'undetermined'
await Carillon.getPermission(); // same values, never prompts
if (!(await Carillon.canRequestPermission())) Carillon.openNotificationSettings();

Carillon.identify('user-42'); // null forgets the identifier
Carillon.setTags({ plan: 'pro', seats: 12 }); // replaced whole, never merged
Carillon.optOut();
Carillon.optIn();

const off = Carillon.onOpened((notification) => {
  console.log(notification.deliveryId, notification.payload);
});

const diagnostics = await Carillon.debugInfo();
console.log(diagnostics);
```

Registration requires a push token and network access. Check `device_id` and
`last_registration_result` in diagnostics to confirm it completed. Then send a
test notification from the dashboard and tap it to verify the open callback.

Tags replace the entire map. Opt-in changes sync to the server and do not change
OS permission. Pass an API base URL as `endpoint` for staging or local development.
Debug logging is disabled in iOS release builds and non-debuggable Android apps.

`onOpened` returns an unsubscribe function. Pending cold-start opens are replayed
when the first subscriber attaches. The reserved `payload.carillon` field is an object on both platforms; the bridge
parses the Android JSON stamp. Customer payload fields remain unchanged.

## Native setup

Forward the callbacks below for a bare React Native app. The
[Expo config plugin](#expo-setup) adds them during prebuild.

### iOS

Add the push capability to your target. Make the app delegate the
notification-center delegate at the top of `didFinishLaunchingWithOptions`, so
that a launch from a tap has somewhere to deliver its open to, then forward four
callbacks from `AppDelegate.swift`:

```swift
import UserNotifications
import CarillonReactNative

// In application(_:didFinishLaunchingWithOptions:), before anything else:
UNUserNotificationCenter.current().delegate = self

func application(
  _ application: UIApplication,
  didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
) {
  CarillonBridge.didRegister(token: deviceToken)
}

func application(
  _ application: UIApplication,
  didFailToRegisterForRemoteNotificationsWithError error: Error
) {
  CarillonBridge.didFailToRegister(error)
}

func userNotificationCenter(
  _ center: UNUserNotificationCenter,
  didReceive response: UNNotificationResponse,
  withCompletionHandler completionHandler: @escaping () -> Void
) {
  CarillonBridge.didOpen(response)
  completionHandler()
}

func userNotificationCenter(
  _ center: UNUserNotificationCenter,
  willPresent notification: UNNotification,
  withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
) {
  CarillonBridge.willPresent(notification, completionHandler: completionHandler)
}
```

The app delegate must conform to `UNUserNotificationCenterDelegate` for the last
two. If another library already owns the delegate, see
[Using Carillon beside another notification library](#using-carillon-beside-another-notification-library).

### Android

Declare the permission under `<manifest>` and the service under `<application>`:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
  android:name="dev.carillon.sdk.CarillonMessagingService"
  android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

An app that already has a `FirebaseMessagingService` keeps it and forwards
`Carillon.didRotate(token)` and `Carillon.didReceive(message)` instead — Firebase
dispatches to one service per application, so two declarations mean one of them
silently never runs. When that service lives in another React Native library and exposes all incoming
messages, forward from JavaScript; see
[Using Carillon beside another notification library](#using-carillon-beside-another-notification-library).

Import `dev.carillon.sdk.Carillon` and forward launcher intents from your activity:

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  Carillon.didOpen(intent)
}

override fun onNewIntent(intent: Intent) {
  super.onNewIntent(intent)
  Carillon.didOpen(intent)
}
```

Bring your own `google-services.json` (Firebase console → add an Android app
with your package name) and apply the `com.google.gms.google-services` Gradle
plugin.

## Expo setup

Add the plugin to your Expo configuration:

```json
{
  "expo": {
    "plugins": ["@exostack/carillon-react-native"],
    "android": { "googleServicesFile": "./google-services.json" }
  }
}
```

`expo prebuild` then writes, on iOS: the push entitlement, the
notification-center delegate installation at the top of
`didFinishLaunchingWithOptions`, the four forwarded callbacks with the
`UNUserNotificationCenterDelegate` conformance, and the
`CarillonNotificationExtension` target for images. On Android: the messaging
service, the runtime permission, the google-services wiring, and the
`Carillon.didOpen(intent)` forwarding in Kotlin `MainActivity.onCreate` and
`onNewIntent`, preserving existing callbacks. Java activities require conversion
to Kotlin for this plugin; bare installations can use the manual forwarding shown
above. Every transform is idempotent, because prebuild runs them again over its
own output.

Options:

```json
["@exostack/carillon-react-native", {
  "installNotificationCenterDelegate": true,
  "messagingService": "auto"
}]
```

- `installNotificationCenterDelegate` (default `true`). Set to `false` when
  another library owns the iOS notification-center delegate: the plugin then
  writes only the two registration callbacks. The existing delegate must forward
  opens and foreground presentation; JavaScript forwarding alone cannot provide
  iOS foreground presentation.
- `messagingService`: `"auto"` (default), `"carillon"` or `"external"`. In
  `auto`, the Carillon service is declared unless an installed package declares
  its own Firebase messaging service in its Android manifest, in which case
  prebuild prints a warning naming that package and the app forwards token
  rotation and messages from JavaScript.
  `carillon` always declares it; `external` never does.

## Native dependencies

The podspec resolves `carillon-swift` through Swift Package Manager with minimum
version `0.2.1`. Gradle resolves `com.exostack:carillon:0.2.1`.

For local development, clone the native SDKs beside this repository:

```text
exostack/
├── carillon-react-native/
├── carillon-swift/
└── carillon-kotlin/
```

For iOS, set `CARILLON_SWIFT_PATH` to the absolute Swift checkout path before
running `pod install` or `expo prebuild`: the podspec resolves the app's
dependency from it, and the Expo plugin references the generated notification
extension's package from it as a local package. The example Podfile detects the
sibling checkout automatically.

For Android, publish the local SDK and enable `mavenLocal()` in the consuming
project. The example already enables it:

```sh
cd ../carillon-kotlin
./gradlew publishToMavenLocal
```

## Run the example

The example calls a configured API and displays SDK diagnostics.

```sh
yarn                       # from the repository root
yarn example start
yarn example android       # or: yarn example ios
```

It defaults to the monorepo's local API — `http://10.0.2.2:28080` on Android,
which is how an emulator reaches the host machine, and `http://localhost:28080`
on a simulator. The endpoint and the mobile key are editable and persisted.

The example uses `dev.carillon.example` as its iOS bundle identifier and Android
package name. Provide your own `example/android/app/google-services.json` and
matching provider credentials.

## Tests

```sh
yarn test        # the JavaScript layer and the Expo plugin's transforms
yarn typecheck
```

Tests cover argument forwarding, subscriptions, cold-start replay ordering, and
Expo configuration transforms. Registration and retry tests live in the native SDKs.

Not covered here: the bridges' three-second foreground timeout and their handling
of a late or duplicate `finishReceived` answer live in `ios/CarillonBridge.swift`
and `CarillonModule.kt`, which have no test target in this repository. The
JavaScript suite only asserts what is sent to the mocked native module.

[swift]: https://github.com/exostack/carillon-swift
[kotlin]: https://github.com/exostack/carillon-kotlin


## Device identity

```ts
const id = await Carillon.getDeviceId();
const unsubscribe = Carillon.onDeviceIdChanged((id) => console.log(id));
```

The SDK persists a random installation secret and the last confirmed device ID.
Token rotation reuses that ID when the server validates the proof. Reinstallation
or merging with an existing token registration can change the ID; the callback
fires on first registration and when the confirmed ID changes. A subscriber
attached after the ID is already known receives it immediately, so it needs no
separate `getDeviceId` call at startup. The ID itself is not a credential. Never
log or export the installation secret.


## Foreground presentation and images

```ts
const off = Carillon.onReceived(async (notification) => {
  // Use notification.data for your route or in-app UI.
  return 'show' // or 'suppress'
})
Carillon.clearNotifications()
```

Only one foreground handler is active; a new subscription replaces it. Native code defaults to
showing after three seconds without an answer. Exceptions and rejected promises also show.
Clearing removes delivered notifications and, on Android, cancels pending display work.

For bare iOS, forward `userNotificationCenter(_:willPresent:withCompletionHandler:)` to
`CarillonBridge.willPresent(notification, completionHandler: completionHandler)`.
The Expo plugin inserts this forwarding. Keep the delegate installed at launch.

For iOS images, the Expo plugin creates `CarillonNotificationExtension`, including its Swift
package product dependency and the EAS `extra.eas.build.experimental.ios.appExtensions` entry.
Set `ios.bundleIdentifier`; sign the extension bundle `<bundle>.CarillonNotificationExtension`
and rebuild after prebuild. No App Group is needed. Bare apps add that target using the
[Swift SDK extension setup](https://github.com/exostack/carillon-swift#notification-images).
If the app already has a notification service extension, integrate the image helper
into that extension rather than embedding a second one.

Android foreground rendering uses `carillon_default` unless the requested channel already
exists. Supply `carillon_notification_icon` as a drawable; otherwise the app icon is used.
Images have a 10-second budget and fall back to text. Android 8+ channels control sound;
Android 13+ needs notification permission. FCM handles background notification display.

## Using Carillon beside another notification library

First check which native callbacks the existing library owns and whether it
exposes notifications sent outside its own service. A library's click handler
may only report its own notifications. In that case, JavaScript forwarding
cannot recover Carillon taps.

On iOS, install an app-owned `UNUserNotificationCenterDelegate` at launch or use
an existing delegate that explicitly forwards `didReceive` to
`CarillonBridge.didOpen` and `willPresent` to `CarillonBridge.willPresent`.
The latter is required for `onReceived` and its `suppress` decision. The delegate
must call each completion handler exactly once; do not also call it after
passing it to `CarillonBridge.willPresent`. Libraries that swizzle these methods
need a tested integration: disabling their interception can stop their own
notification handling. Test both providers before releasing a coexistence build.

On Android, keep exactly one `FirebaseMessagingService`. If its React Native
wrapper exposes all incoming messages, token changes and taps, forward them
using that wrapper's documented hooks. The following example uses a
Firebase Messaging-style API; it does not apply to libraries without these hooks:

```ts
import Carillon from '@exostack/carillon-react-native';

// Android token rotation. No effect on iOS, where the token arrives through
// the app delegate's registration callback.
messaging().onTokenRefresh(Carillon.didRotateToken);

// Android messages, including those received in the background. No effect on
// iOS, where foreground presentation is decided in the delegate.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  Carillon.didReceive(remoteMessage.data ?? {});
});
messaging().onMessage(async (remoteMessage) => {
  Carillon.didReceive(remoteMessage.data ?? {});
});

// Taps, warm and cold. Payloads without a Carillon delivery id are ignored.
messaging().onNotificationOpenedApp((remoteMessage) => {
  Carillon.didOpen(remoteMessage.data ?? {});
});
const initial = await messaging().getInitialNotification();
if (initial) Carillon.didOpen(initial.data ?? {});
```

Use these hooks only when your installed messaging library provides them.
On iOS, a JavaScript tap hook can forward the notification's full `userInfo`
to `didOpen` only if it actually receives notifications sent by Carillon.

On Android, `didReceive` runs the foreground display path for a Carillon message
and `didRotateToken` updates the FCM token. Object and array values are
serialised to JSON strings, which is how the data map travels over FCM.

On iOS, `didReceive` is a no-op: it cannot answer the native presentation callback.
`CarillonBridge.willPresent` forwards that callback to `onReceived`, waits for
its asynchronous decision, and falls back to showing after three seconds.

With Expo, set `installNotificationCenterDelegate: false` only when an existing
delegate provides the native forwarding above. Set `messagingService: "external"`
only when another Android service forwards messages and token changes.
The `auto` mode detects `MESSAGING_EVENT` services, not broadcast receivers;
a receiver alone does not replace the Carillon service.

Verify registration, foreground show/suppress, background taps, cold-start taps,
and token rotation. During coexistence, run these checks for each sender.

## Android background appearance

Messages with a `notification` payload are displayed by Firebase while the app
is in the background. They bypass `CarillonMessagingService` and its display
settings. Foreground Carillon rendering uses `carillon_default` and the drawable
`carillon_notification_icon`; Firebase needs its own defaults.

Add a monochrome notification drawable named `carillon_notification_icon`, then
put these entries inside `<application>` in `AndroidManifest.xml`:

```xml
<meta-data
  android:name="com.google.firebase.messaging.default_notification_icon"
  android:resource="@drawable/carillon_notification_icon" />
<meta-data
  android:name="com.google.firebase.messaging.default_notification_channel_id"
  android:value="carillon_default" />
```

Create the channel at startup, before the first background notification. For
example, add this to your application's `onCreate`, after `super.onCreate()`:

```kotlin
if (android.os.Build.VERSION.SDK_INT >= 26) {
  getSystemService(android.app.NotificationManager::class.java)
    .createNotificationChannel(android.app.NotificationChannel(
      "carillon_default", "Notifications", android.app.NotificationManager.IMPORTANCE_DEFAULT
    ))
}
```

Use a localized channel name in your app. If you choose a different channel ID,
create it before use and configure the Firebase default accordingly. Existing
channels keep the user's settings.

Without these defaults Firebase may use its fallback channel and the app icon.
Changing to data-only messages changes background processing and delivery
behavior; it is not required to configure the icon and channel. See
[Firebase message handling](https://firebase.google.com/docs/cloud-messaging/android/receive-messages).
