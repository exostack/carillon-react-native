import { withNotificationExtension } from './extension';
import {
  AndroidConfig,
  WarningAggregator,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withEntitlementsPlist,
  withMainActivity,
  withProjectBuildGradle,
  type ConfigPlugin,
} from '@expo/config-plugins';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The Expo config plugin.
 *
 * It does by hand what a bare install asks a developer to do by hand, and
 * nothing beyond that: the push entitlement, the notification-center delegate
 * and the forwarded callbacks on iOS, the messaging service and the
 * google-services wiring on Android. Every transform below is a pure function
 * of the file it edits, which is what lets them be tested without an Expo
 * runtime, and every one of them is idempotent, because `expo prebuild` runs
 * them again over their own output.
 */

export type MessagingServiceMode = 'auto' | 'carillon' | 'external';

export type CarillonPluginProps = {
  /**
   * Whether the plugin makes the AppDelegate the notification-center delegate
   * and inserts the `userNotificationCenter` callbacks. Set to `false` when
   * another notification library owns the delegate, and forward opens from
   * JavaScript instead. Defaults to `true`.
   */
  installNotificationCenterDelegate?: boolean;
  /**
   * Whether to declare the SDK's Firebase messaging service on Android.
   * `auto` declares it unless a package that ships its own is installed;
   * `carillon` always declares it; `external` never does. Defaults to `auto`.
   */
  messagingService?: MessagingServiceMode;
};

/**
 * The version of the Google Services Gradle plugin the Android SDK's own
 * example pins. Applied here for the same reason it is applied there: it turns
 * `google-services.json` into resources at build time, and Firebase Messaging
 * cannot find its project without them.
 */
export const GOOGLE_SERVICES_VERSION = '4.4.4';

const MESSAGING_SERVICE = 'dev.carillon.sdk.CarillonMessagingService';
const MESSAGING_EVENT = 'com.google.firebase.MESSAGING_EVENT';

const LIBRARY_MANIFEST = join('android', 'src', 'main', 'AndroidManifest.xml');

const DELEGATE_INSTALL = 'UNUserNotificationCenter.current().delegate = self';

function baseClass(contents: string): string | undefined {
  return /class\s+AppDelegate\s*:\s*([A-Za-z0-9_]+)/.exec(contents)?.[1];
}

/**
 * Whether the two registration callbacks have to be marked `override`.
 *
 * Only `ExpoAppDelegate` implements them itself, so a method that does not say
 * `override` fails to compile against it. `RCTAppDelegate` and a bare
 * `UIResponder` implement neither, and there `override` is the error instead.
 * Neither base class implements any `UNUserNotificationCenterDelegate` method,
 * so those are never overrides.
 */
export function needsOverride(contents: string): boolean {
  return baseClass(contents) === 'ExpoAppDelegate';
}

function implementsDidFinishLaunching(contents: string): boolean {
  const base = baseClass(contents);

  return base === 'ExpoAppDelegate' || base === 'RCTAppDelegate';
}

/**
 * The two registration callbacks, written for the AppDelegate this app has.
 *
 * Against a base class that already implements them, each one ends by calling
 * `super`: whatever else the app has installed keeps working, because the point
 * of forwarding explicitly rather than swizzling is that nobody's callback
 * disappears.
 */
function registrationMethods(override: boolean): string {
  const declare = (signature: string) =>
    override ? `  override func ${signature}` : `  func ${signature}`;

  const chain = (call: string) => (override ? `\n    super.${call}` : '');

  return [
    '',
    declare('application('),
    '    _ application: UIApplication,',
    '    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data',
    '  ) {',
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
  ].join('\n');
}

const openMethod = `
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    CarillonBridge.didOpen(response)
    completionHandler()
  }
`;

const foregroundMethod = `
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    CarillonBridge.willPresent(notification, completionHandler: completionHandler)
  }
`;

/** Inserts methods before the closing brace of the AppDelegate class. */
function insertIntoAppDelegate(contents: string, methods: string): string {
  const declaration = /class\s+AppDelegate\b[^{]*\{/.exec(contents);

  if (!declaration) throw new Error('Cannot find the AppDelegate class for Carillon forwarding.');

  const bodyStart = declaration.index + declaration[0].length;
  const bodyEnd = closingBraceOf(contents, bodyStart);

  if (bodyEnd === -1) throw new Error('Cannot find the end of the AppDelegate class.');

  const inserted = [contents.slice(0, bodyEnd), methods, contents.slice(bodyEnd)].join('');

  return addImport('CarillonReactNative', addImport('UserNotifications', inserted));
}

/** Forwards APNs registration success and failure. */
export function addRegistrationForwarding(contents: string): string {
  if (contents.includes('CarillonBridge.didRegister(')) return contents;

  return insertIntoAppDelegate(contents, registrationMethods(needsOverride(contents)));
}

/**
 * Forwards notification taps. Every response is forwarded: a notification that
 * is not Carillon's carries no delivery id and is ignored by the SDK.
 */
export function addOpenForwarding(contents: string): string {
  if (contents.includes('CarillonBridge.didOpen(')) return contents;

  return insertIntoAppDelegate(contents, openMethod);
}

/** Route presentation through the bridge once; preserve existing handling for other providers. */
export function addForegroundForwarding(contents: string): string {
  if (contents.includes('CarillonBridge.willPresent(')) return contents;
  const existing = /func\s+userNotificationCenter\s*\([\s\S]*?willPresent\s+(\w+):\s*UNNotification\s*,\s*withCompletionHandler\s+(\w+):[^\{]+\{/.exec(contents);
  if (existing) {
    const offset = existing.index + existing[0].length;
    const notification = existing[1]!;
    const completion = existing[2]!;
    return contents.slice(0, offset) + `
    if ${notification}.request.content.userInfo["carillon"] != nil {
      CarillonBridge.willPresent(${notification}, completionHandler: ${completion})
      return
    }
` + contents.slice(offset);
  }

  return insertIntoAppDelegate(contents, foregroundMethod);
}

/** Declares the conformance the two `userNotificationCenter` methods satisfy. */
export function addNotificationCenterConformance(contents: string): string {
  if (contents.includes('UNUserNotificationCenterDelegate')) return contents;

  const declaration = /class\s+AppDelegate\b[^{]*\{/.exec(contents);

  if (!declaration) throw new Error('Cannot find the AppDelegate class for Carillon forwarding.');

  const bodyEnd = closingBraceOf(contents, declaration.index + declaration[0].length);

  if (bodyEnd === -1) throw new Error('Cannot find the end of the AppDelegate class.');

  const after = bodyEnd + 1;

  return `${contents.slice(0, after)}\n\nextension AppDelegate: UNUserNotificationCenterDelegate {}${contents.slice(after)}`;
}

/**
 * Makes the AppDelegate the notification-center delegate at the top of
 * `didFinishLaunchingWithOptions`, so that a launch from a tap has somewhere to
 * deliver its open to. Writes the method when the file has none.
 */
export function installNotificationCenterDelegate(contents: string): string {
  if (contents.includes(DELEGATE_INSTALL)) return contents;

  const existing = /func\s+application\s*\(\s*_\s+\w+\s*:\s*UIApplication\s*,\s*didFinishLaunchingWithOptions[^{]*\{/.exec(contents);

  if (existing) {
    const offset = existing.index + existing[0].length;

    return addImport('UserNotifications', `${contents.slice(0, offset)}\n    ${DELEGATE_INSTALL}${contents.slice(offset)}`);
  }

  const override = implementsDidFinishLaunching(contents);
  const method = `
  ${override ? 'override ' : ''}func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    ${DELEGATE_INSTALL}
    return ${override ? 'super.application(application, didFinishLaunchingWithOptions: launchOptions)' : 'true'}
  }
`;

  return insertIntoAppDelegate(contents, method);
}

/**
 * The whole AppDelegate transform.
 *
 * The SDK swizzles nothing — that is a decision, not an omission — so these
 * lines have to exist somewhere. Written here rather than expected of the
 * customer is the whole difference between the managed workflow and the bare
 * one. Without the delegate, only the registration callbacks are written: the
 * app forwards opens from JavaScript through the library that owns it.
 */
export function addCarillonForwarding(
  contents: string,
  options: { installNotificationCenterDelegate?: boolean } = {}
): string {
  const registered = addRegistrationForwarding(contents);

  if (options.installNotificationCenterDelegate === false) return registered;

  return installNotificationCenterDelegate(
    addNotificationCenterConformance(addForegroundForwarding(addOpenForwarding(registered)))
  );
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

function packagesIn(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return [];

  return readdirSync(nodeModules).flatMap((name) => {
    if (name.startsWith('.')) return [];
    if (!name.startsWith('@')) return [name];

    const scope = join(nodeModules, name);

    return existsSync(scope) ? readdirSync(scope).map((scoped) => `${name}/${scoped}`) : [];
  });
}

function declaresMessagingService(packageRoot: string): boolean {
  const manifest = join(packageRoot, LIBRARY_MANIFEST);

  if (!existsSync(manifest)) return false;

  const contents = readFileSync(manifest, 'utf8');

  return contents.includes(MESSAGING_EVENT) && !contents.includes(MESSAGING_SERVICE);
}

/** Installed packages whose Android manifest declares a Firebase messaging service. */
export function installedMessagingServicePackages(projectRoot: string): string[] {
  const found = new Set<string>();

  for (let directory = projectRoot; ; directory = dirname(directory)) {
    const nodeModules = join(directory, 'node_modules');

    for (const name of packagesIn(nodeModules)) {
      if (declaresMessagingService(join(nodeModules, name))) found.add(name);
    }

    if (dirname(directory) === directory) return [...found].sort();
  }
}

/**
 * Whether the SDK's service is declared, and which packages stand in its way.
 *
 * The app manifest alone cannot answer this: a library's service arrives at
 * manifest merge, after the plugin has run, and two services mean one of them
 * silently never runs.
 */
export function resolveMessagingService(
  mode: MessagingServiceMode,
  projectRoot: string
): { declare: boolean; conflicts: string[] } {
  if (mode === 'carillon') return { declare: true, conflicts: [] };
  if (mode === 'external') return { declare: false, conflicts: [] };

  const conflicts = installedMessagingServicePackages(projectRoot);

  return { declare: conflicts.length === 0, conflicts };
}

/**
 * Declares the SDK's `FirebaseMessagingService`, unless the app manifest
 * already has one.
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

const withCarillon: ConfigPlugin<CarillonPluginProps | void> = (config, props) => {
  const installDelegate = props?.installNotificationCenterDelegate ?? true;
  const messagingService = props?.messagingService ?? 'auto';

  config = withEntitlementsPlist(config, (entitlements) => {
    entitlements.modResults = setApsEnvironment(entitlements.modResults);

    return entitlements;
  });

  config = withAppDelegate(config, (appDelegate) => {
    appDelegate.modResults.contents = addCarillonForwarding(appDelegate.modResults.contents, {
      installNotificationCenterDelegate: installDelegate,
    });

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
    const { declare, conflicts } = resolveMessagingService(
      messagingService,
      manifest.modRequest.projectRoot
    );

    if (conflicts.length > 0) {
      WarningAggregator.addWarningAndroid(
        'carillon',
        `${conflicts.join(', ')} declares its own Firebase messaging service, so the Carillon service is not declared. Forward token rotation to Carillon.didRotateToken and received messages to Carillon.didReceive from that library, or set messagingService: 'carillon' to declare it anyway.`
      );
    }

    if (!declare) return manifest;

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifest.modResults
    );

    Object.assign(application, addMessagingService(application));

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

  config = withNotificationExtension(config);

  return AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.POST_NOTIFICATIONS',
  ]);
};

export default withCarillon;
