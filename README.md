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

Add the push capability to your target, then forward three callbacks from
`AppDelegate.swift`:

```swift
import CarillonReactNative

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
```

Use `CarillonBridge` from `CarillonReactNative` in the app delegate.

Set `UNUserNotificationCenter.current().delegate` before anything else in
`didFinishLaunching`, so that a launch from a tap has somewhere to deliver its
open to.

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
silently never runs.

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

`expo prebuild` then writes the push entitlement and the three forwarded
callbacks on iOS, and the messaging service, the runtime permission and the
google-services wiring on Android. It also forwards notification opens from
Kotlin `MainActivity.onCreate` and `onNewIntent`, preserving existing callbacks.
Java activities require conversion to Kotlin for this plugin; bare installations
can use the manual forwarding shown above. Every transform is idempotent, because
prebuild runs them again over their own output.

## Native dependencies

The podspec resolves `carillon-swift` through Swift Package Manager with minimum
version `0.1.1`. Gradle resolves `dev.carillon:carillon:0.1.1`.

For local development, clone the native SDKs beside this repository:

```text
exostack/
├── carillon-react-native/
├── carillon-swift/
└── carillon-kotlin/
```

For iOS, set `CARILLON_SWIFT_PATH` to the absolute Swift checkout path before
running `pod install`. The example Podfile detects the sibling checkout automatically.

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

[swift]: https://github.com/exostack/carillon-swift
[kotlin]: https://github.com/exostack/carillon-kotlin
