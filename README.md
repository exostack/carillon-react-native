# @carillon/react-native

Carillon React Native SDK. A bridge over [carillon-swift][swift] and
[carillon-kotlin][kotlin], and nothing more.

Registration, retries, the event queue, environment detection, the open held
across a cold start — all of it lives in the native SDKs, once. Any behaviour
that existed only in this package would be a second implementation of a
protocol that already has one, and a behaviour every other wrapper would then
be missing. `src/` maps arguments, forwards calls and manages subscriptions;
that is the whole job.

Zero runtime dependencies. `react` and `react-native` are peers.

## Installing

```sh
yarn add @carillon/react-native
```

The native SDKs come with it: the podspec declares the Swift package, the Gradle
module declares `dev.carillon:carillon`. See **Native dependencies** below for
what resolves them today, which is not yet what will resolve them tomorrow.

## Surface

```ts
import Carillon from '@carillon/react-native';

Carillon.configure({ key: 'carillon_mk_live_…', debug: __DEV__ });

const { status } = await Carillon.register(); // 'registered' | 'denied' | 'simulator'

Carillon.identify('user-42'); // null forgets the identifier
Carillon.setTags({ plan: 'pro', seats: 12 }); // replaced whole, never merged
Carillon.optOut();
Carillon.optIn();

const off = Carillon.onOpened((notification) => {
  router.push(notification.payload.url as string);
});

await Carillon.debugInfo(); // paste this into a support ticket
```

`onOpened` covers the cold start: an app launched by a tap receives the event
once the first subscriber attaches, because the native held it until then. The
handler is given the delivery id, the instant of the tap, and the payload as the
platform delivered it — the reserved `carillon` key is an object on iOS and a
JSON string on Android, because that is what APNs and FCM respectively carry.
`deliveryId` is surfaced separately so that no app has to know the difference.

Everything else in the payload is the customer's own. Carillon carries it and
takes no position on what it means.

## Integrating, bare

Both platforms need the callbacks forwarded explicitly. The SDKs swizzle
nothing — a decision, not an omission: swizzling is invisible in your own code,
fights other SDKs for the same selectors, and breaks silently on new lifecycles.
Under Expo, [the config plugin](#integrating-under-expo) writes all of this for
you.

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

`CarillonBridge` rather than `Carillon`: your app links this package, and the
Swift SDK is resolved for this package's pod alone, so `import Carillon` in an
app delegate would not compile. The three calls forward straight through.

Set `UNUserNotificationCenter.current().delegate` before anything else in
`didFinishLaunching`, so that a launch from a tap has somewhere to deliver its
open to.

### Android

Declare the service the SDK ships, and ask for the runtime permission:

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

Forward the launching intent from your activity:

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
plugin. Your Firebase project, your quota, as the server side documents.

## Integrating under Expo

Managed and bare are both first-class, and the plugin is part of this package
rather than a separate one:

```json
{
  "expo": {
    "plugins": ["@carillon/react-native"],
    "android": { "googleServicesFile": "./google-services.json" }
  }
}
```

`expo prebuild` then writes the push entitlement and the three forwarded
callbacks on iOS, and the messaging service, the runtime permission and the
google-services wiring on Android. Every transform is idempotent, because
prebuild runs them again over their own output.

The entitlement is written as `aps-environment: development`, which is what a
debug build is signed with and what EAS replaces for a production build. The SDK
never reads that value: it parses the embedded provisioning profile at runtime,
so what it reports is what the binary was actually signed with.

## Native dependencies

Two layers, because the native SDKs are not published yet.

**What a customer's install does.** `CarillonReactNative.podspec` declares the
Swift package by URL through React Native's `spm_dependency` helper, and
`android/build.gradle` depends on `dev.carillon:carillon:0.1.0`. Nothing else is
required of the app.

**What development does today.** The URL does not answer and the coordinate is
not on Maven Central, so each side is resolved locally, from checkouts sitting
beside this repository:

```
exostack/
├── carillon-react-native/   ← here
├── carillon-swift/
└── carillon-kotlin/
```

- **iOS.** `example/ios/Podfile` sets `CARILLON_SWIFT_PATH` to
  `../../../carillon-swift` when that directory exists, and the podspec then
  declares the same SPM dependency by path instead of by URL. Both produce the
  same `import Carillon`, so nothing in `ios/` knows which one it got. The path
  has to be absolute: CocoaPods records it in the Pods project, whose directory
  is not the one the Podfile is read from.

- **Android.** `./gradlew publishToMavenLocal` in `carillon-kotlin` publishes
  `dev.carillon:carillon:0.1.0` to `~/.m2`, and `example/android/build.gradle`
  adds `mavenLocal()` to every project. The coordinate is the published one, so
  nothing changes on the day the artifact stops being local. A composite build
  (`includeBuild`) would substitute the same coordinate, but the two builds pin
  different Android Gradle plugin versions and the local repository does not
  care.

Run the publish step once before building the example for Android:

```sh
cd ../carillon-kotlin && ./gradlew publishToMavenLocal
```

## The example

A test bench, not a product: every control exercises one call of the SDK against
a real server and shows what came back.

```sh
yarn                       # from the repository root
yarn example start
yarn example android       # or: yarn example ios
```

It defaults to the monorepo's local API — `http://10.0.2.2:28080` on Android,
which is how an emulator reaches the host machine, and `http://localhost:28080`
on a simulator. The endpoint and the mobile key are editable and persisted.

The bundle identifier and application id are both `dev.carillon.example`,
deliberately shared with the native SDKs' own benches: that App ID is registered
with Apple's push capability, and the Firebase project already knows the Android
package. `example/android/app/google-services.json` is git-ignored — it names a
personal Firebase project, and the bench must not assume anyone's. Bring your
own.

## Tests

```sh
yarn test        # the JavaScript layer and the Expo plugin's transforms
yarn typecheck
```

What is asserted here is what this package decides: that arguments are mapped,
that subscriptions are added and removed, that a listener is attached before the
native is asked to release what it has been holding, and that every config
transform is idempotent. Everything the SDK actually does is tested where it is
implemented, in [carillon-swift][swift] and [carillon-kotlin][kotlin].

[swift]: https://github.com/exostack/carillon-swift
[kotlin]: https://github.com/exostack/carillon-kotlin
