import {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withEntitlementsPlist,
  withMainActivity,
  withProjectBuildGradle,
  type ConfigPlugin,
} from '@expo/config-plugins';

/**
 * The Expo config plugin.
 *
 * It does by hand what a bare install asks a developer to do by hand, and
 * nothing beyond that: the push entitlement and the two forwarded delegate
 * callbacks on iOS, the messaging service and the google-services wiring on
 * Android. Every transform below is a pure function of the file it edits, which
 * is what lets them be tested without an Expo runtime, and every one of them is
 * idempotent, because `expo prebuild` runs them again over their own output.
 */

/**
 * The version of the Google Services Gradle plugin the Android SDK's own
 * example pins. Applied here for the same reason it is applied there: it turns
 * `google-services.json` into resources at build time, and Firebase Messaging
 * cannot find its project without them.
 */
export const GOOGLE_SERVICES_VERSION = '4.4.4';

const MESSAGING_SERVICE = 'dev.carillon.sdk.CarillonMessagingService';
const MESSAGING_EVENT = 'com.google.firebase.MESSAGING_EVENT';

/**
 * Whether the forwarding methods have to be marked `override`.
 *
 * `ExpoAppDelegate` and `RCTAppDelegate` implement these callbacks themselves,
 * so a method that does not say `override` fails to compile against them. A
 * bare `class AppDelegate: UIResponder, UIApplicationDelegate` inherits neither
 * — `UIResponder` is a superclass that knows nothing about push — and there
 * `override` is the error instead. The declaration is the only place that says
 * which of the two this file is.
 */
export function needsOverride(contents: string): boolean {
  const declaration = /class\s+AppDelegate\s*:\s*([A-Za-z0-9_]+)/.exec(contents);
  const base = declaration?.[1];

  return base === 'ExpoAppDelegate' || base === 'RCTAppDelegate';
}

/**
 * The three forwarded callbacks, written for the AppDelegate this app has.
 *
 * Against a base class that already implements them, each one ends by calling
 * `super`: whatever else the app has installed — Expo's own notification
 * handling, another SDK — keeps working, because the point of forwarding
 * explicitly rather than swizzling is that nobody's callback disappears.
 */
function forwardingMethods(override: boolean): string {
  const declare = (signature: string) =>
    override ? `  override func ${signature}` : `  func ${signature}`;

  const chain = (call: string) => (override ? `\n    super.${call}` : '');

  return [
    '',
    declare('application('),
    '    _ application: UIApplication,',
    '    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data',
    '  ) {',
    "    // The `Data` goes over as it arrived. Hex-encoding is the SDK's job,",
    '    // which is what makes sending `deviceToken.description` — the classic',
    '    // mistake — something this line cannot express.',
    '    CarillonBridge.didRegister(token: deviceToken)' +
      chain(
        'application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)'
      ),
    '  }',
    '',
    declare('application('),
    '    _ application: UIApplication,',
    '    didFailToRegisterForRemoteNotificationsWithError error: Error',
    '  ) {',
    '    CarillonBridge.didFailToRegister(error)' +
      chain(
        'application(application, didFailToRegisterForRemoteNotificationsWithError: error)'
      ),
    '  }',
    '',
    declare('userNotificationCenter('),
    '    _ center: UNUserNotificationCenter,',
    '    didReceive response: UNNotificationResponse,',
    '    withCompletionHandler completionHandler: @escaping () -> Void',
    '  ) {',
    '    // Forward every response. A notification that is not ours carries no',
    '    // delivery id and is ignored, so this file does not have to work out',
    '    // which is which.',
    '    CarillonBridge.didOpen(response)',
    override
      ? '    super.userNotificationCenter(center, didReceive: response, withCompletionHandler: completionHandler)'
      : '    completionHandler()',
    '  }',
    '',
  ].join('\n');
}

/**
 * Inserts the forwarding callbacks into the AppDelegate class body.
 *
 * The SDK swizzles nothing — that is a decision, not an omission — so these
 * lines have to exist somewhere. Written here rather than expected of the
 * customer is the whole difference between the managed workflow and the bare
 * one.
 */
export function addCarillonForwarding(contents: string): string {
  if (contents.includes('CarillonBridge.didRegister(')) return contents;

  const declaration = /class\s+AppDelegate\b[^{]*\{/.exec(contents);

  if (!declaration || declaration.index === undefined) return contents;

  const bodyStart = declaration.index + declaration[0].length;
  const bodyEnd = closingBraceOf(contents, bodyStart);

  if (bodyEnd === -1) return contents;

  const inserted = [
    contents.slice(0, bodyEnd),
    forwardingMethods(needsOverride(contents)),
    contents.slice(bodyEnd),
  ].join('');

  return addImport('CarillonReactNative', addImport('UserNotifications', inserted));
}

/** Adds an import after the last one, unless the file already has it. */
export function addImport(module: string, contents: string): string {
  if (new RegExp(`^import ${module}$`, 'm').test(contents)) return contents;

  const imports = [...contents.matchAll(/^import .+$/gm)];
  const last = imports[imports.length - 1];

  if (!last || last.index === undefined) return `import ${module}\n${contents}`;

  const end = last.index + last[0].length;

  return `${contents.slice(0, end)}\nimport ${module}${contents.slice(end)}`;
}

/** Walks to the brace that closes the one just opened, counting the nesting. */
function closingBraceOf(contents: string, from: number): number {
  let depth = 1;

  for (let index = from; index < contents.length; index += 1) {
    const character = contents[index];

    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * Declares the push entitlement.
 *
 * `development` is what a debug build is signed with, and what EAS replaces
 * with `production` when it builds one. The SDK never reads this value from the
 * entitlements file — it parses the embedded provisioning profile at runtime —
 * so the two cannot fall out of step by being edited here.
 */
export function setApsEnvironment<T extends object>(
  entitlements: T
): T & { 'aps-environment': string } {
  return { ...entitlements, 'aps-environment': 'development' };
}

/**
 * Declares the SDK's `FirebaseMessagingService`, unless the app already has one.
 *
 * Firebase dispatches to a single service per application, so a second
 * declaration means one of them silently never runs. An app that brings its own
 * keeps it and forwards two calls instead, exactly as the Android SDK
 * documents.
 */
export function addMessagingService(
  application: AndroidConfig.Manifest.ManifestApplication
): AndroidConfig.Manifest.ManifestApplication {
  const services = application.service ?? [];
  const declared = services.some((service) =>
    service['intent-filter']?.some((filter) =>
      filter.action?.some((action) => action.$['android:name'] === MESSAGING_EVENT)
    )
  );

  if (declared) return application;

  return {
    ...application,
    service: [
      ...services,
      {
        $: { 'android:name': MESSAGING_SERVICE, 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': MESSAGING_EVENT } }] }],
      },
    ],
  };
}

/** The classpath the `com.google.gms.google-services` plugin is applied from. */
export function addGoogleServicesClasspath(contents: string): string {
  if (contents.includes('com.google.gms:google-services')) return contents;

  return contents.replace(
    /(dependencies\s*\{)/,
    `$1\n        classpath("com.google.gms:google-services:${GOOGLE_SERVICES_VERSION}")`
  );
}

/**
 * Applies the plugin in the application module.
 *
 * Guarded on the file being present, as the Android SDK's own example is: a
 * project without `google-services.json` still builds, and push lights up the
 * moment the file is dropped in.
 */
export function applyGoogleServicesPlugin(contents: string): string {
  if (contents.includes('com.google.gms.google-services')) return contents;

  return `${contents.trimEnd()}\n\nif (file("google-services.json").exists()) {\n    apply plugin: "com.google.gms.google-services"\n}\n`;
}

/** Forward cold and warm opens without replacing existing activity callbacks. */
export function addAndroidOpenForwarding(
  contents: string,
  language = "kt",
): string {
  if (language !== "kt") {
    throw new Error(
      "Carillon requires a Kotlin MainActivity for automatic open forwarding. Convert MainActivity to Kotlin or forward Carillon.didOpen(intent) manually.",
    );
  }
  let result = contents;
  for (const name of ["onCreate", "onNewIntent"] as const) {
    const method = new RegExp(
      `override\\s+fun\\s+${name}\\s*\\(\\s*(\\w+)\\s*:[^{]*?\\)[^{]*\\{`,
    ).exec(result);
    if (method) {
      const start = method.index + method[0].length;
      const end = closingBraceOf(result, start);
      if (end === -1)
        throw new Error(`Cannot find the end of MainActivity.${name}.`);
      const body = result.slice(start, end);
      if (/\bCarillon\.didOpen\s*\(/.test(body)) continue;
      const call = new RegExp(`super\\.${name}\\s*\\([^)]*\\)`).exec(body);
      if (!call)
        throw new Error(
          `MainActivity.${name} must call super.${name} before Carillon can forward notification opens.`,
        );
      const argument = name === "onCreate" ? "intent" : method[1]!;
      const setIntent =
        name === "onNewIntent" ? /\bsetIntent\s*\([^)]*\)/.exec(body) : null;
      const after =
        setIntent && setIntent.index > call.index ? setIntent : call;
      const offset = start + after.index + after[0].length;
      const set =
        name === "onNewIntent" && !setIntent
          ? `\n    setIntent(${argument})`
          : "";
      result = `${result.slice(0, offset)}${set}\n    Carillon.didOpen(${argument})${result.slice(offset)}`;
    } else {
      const declaration = /class\s+MainActivity\b[^\{]*\{/.exec(result);
      if (!declaration)
        throw new Error(
          "Cannot find the Kotlin MainActivity class for Carillon open forwarding.",
        );
      const start = declaration.index + declaration[0].length;
      const callback =
        name === "onCreate"
          ? "\n  override fun onCreate(savedInstanceState: android.os.Bundle?) {\n    super.onCreate(savedInstanceState)\n    Carillon.didOpen(intent)\n  }\n"
          : "\n  override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)\n    Carillon.didOpen(intent)\n  }\n";
      result = `${result.slice(0, start)}${callback}${result.slice(start)}`;
    }
  }
  if (!/^import .+$/m.test(result) && /^package .+$/m.test(result)) {
    return result.replace(
      /^(package .+)$/m,
      "$1\n\nimport dev.carillon.sdk.Carillon",
    );
  }
  return addImport("dev.carillon.sdk.Carillon", result);
}

const withCarillon: ConfigPlugin = (config) => {
  config = withEntitlementsPlist(config, (entitlements) => {
    entitlements.modResults = setApsEnvironment(entitlements.modResults);

    return entitlements;
  });

  config = withAppDelegate(config, (appDelegate) => {
    appDelegate.modResults.contents = addCarillonForwarding(
      appDelegate.modResults.contents
    );

    return appDelegate;
  });

  config = withMainActivity(config, (activity) => {
    activity.modResults.contents = addAndroidOpenForwarding(
      activity.modResults.contents,
      activity.modResults.language,
    );
    return activity;
  });

  config = withAndroidManifest(config, (manifest) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifest.modResults
    );
    const updated = addMessagingService(application);

    Object.assign(application, updated);

    return manifest;
  });

  config = withProjectBuildGradle(config, (gradle) => {
    gradle.modResults.contents = addGoogleServicesClasspath(
      gradle.modResults.contents
    );

    return gradle;
  });

  config = withAppBuildGradle(config, (gradle) => {
    gradle.modResults.contents = applyGoogleServicesPlugin(
      gradle.modResults.contents
    );

    return gradle;
  });

  return AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.POST_NOTIFICATIONS',
  ]);
};

export default withCarillon;
