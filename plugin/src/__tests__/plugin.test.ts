import { describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addCarillonForwarding,
  addForegroundForwarding,
  addAndroidOpenForwarding,
  addGoogleServicesClasspath,
  addImport,
  addMessagingService,
  addNotificationCenterConformance,
  applyGoogleServicesPlugin,
  installNotificationCenterDelegate,
  needsOverride,
  resolveMessagingService,
  setApsEnvironment,
} from '../index';

/**
 * The plugin's transforms, each a pure function of the file it edits, which is
 * why they can be asserted here without an Expo runtime anywhere in sight.
 */

const bareAppDelegate = `import UIKit
import React

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return true
  }
}
`;

/** The AppDelegate `expo prebuild` writes from the Expo SDK 55 template, verbatim. */
export const expoAppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

const rctAppDelegate = `import React_RCTAppDelegate

@main
class AppDelegate: RCTAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('addImport', () => {
  it('lands after the last import, not above the file', () => {
    expect(addImport('CarillonReactNative', bareAppDelegate)).toContain(
      'import UIKit\nimport React\nimport CarillonReactNative'
    );
  });

  it('adds nothing twice', () => {
    const once = addImport('CarillonReactNative', bareAppDelegate);

    expect(addImport('CarillonReactNative', once)).toBe(once);
  });

  it('copes with a file that imports nothing', () => {
    expect(addImport('CarillonReactNative', '// nothing here\n')).toBe(
      'import CarillonReactNative\n// nothing here\n'
    );
  });
});

describe('needsOverride', () => {
  it('is true against ExpoAppDelegate, which implements the registration callbacks', () => {
    expect(needsOverride(expoAppDelegate)).toBe(true);
  });

  it('is false against RCTAppDelegate and a bare UIResponder, which implement none of them', () => {
    expect(needsOverride(rctAppDelegate)).toBe(false);
    expect(needsOverride(bareAppDelegate)).toBe(false);
  });
});

describe('addCarillonForwarding', () => {
  it('forwards the four callbacks and imports what they need', () => {
    const result = addCarillonForwarding(bareAppDelegate);

    expect(result).toContain('import CarillonReactNative');
    expect(result).toContain('import UserNotifications');
    expect(result).toContain('CarillonBridge.didRegister(token: deviceToken)');
    expect(result).toContain('CarillonBridge.didFailToRegister(error)');
    expect(result).toContain('CarillonBridge.didOpen(response)');
    expect(result).toContain('CarillonBridge.willPresent(notification, completionHandler: completionHandler)');
  });

  it('leaves the existing body alone', () => {
    expect(addCarillonForwarding(bareAppDelegate)).toContain(
      'didFinishLaunchingWithOptions'
    );
  });

  it('writes no override against a bare UIResponder', () => {
    const result = addCarillonForwarding(bareAppDelegate);

    expect(result).toContain('completionHandler()');
    expect(result).not.toContain('override func');
    expect(result).not.toContain('super.');
  });

  it('overrides only the registration callbacks against ExpoAppDelegate', () => {
    // ExpoAppDelegate implements the two registration callbacks and nothing of
    // UNUserNotificationCenterDelegate, so the chain to super exists for those
    // two alone; an `override` on the other two does not compile.
    const result = addCarillonForwarding(expoAppDelegate);

    expect(result.match(/override func application\(/g)).toHaveLength(2 + 3);
    expect(result).toContain(
      'super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)'
    );
    expect(result).toContain(
      'super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)'
    );
    expect(result).not.toContain('override func userNotificationCenter');
    expect(result).not.toContain('super.userNotificationCenter');
    expect(result).toContain('CarillonBridge.didOpen(response)\n    completionHandler()');
  });

  it('writes no override against RCTAppDelegate, which implements none of the callbacks', () => {
    const result = addCarillonForwarding(rctAppDelegate);

    expect(result).not.toContain('override func application(\n    _ application: UIApplication,\n    didRegister');
    expect(result).not.toContain('super.application(application, didRegister');
    expect(result).not.toContain('override func userNotificationCenter');
  });

  it('makes the AppDelegate the notification-center delegate at the top of didFinishLaunching', () => {
    const result = addCarillonForwarding(expoAppDelegate);

    expect(result).toContain(
      ') -> Bool {\n    UNUserNotificationCenter.current().delegate = self\n    let delegate = ReactNativeDelegate()'
    );
    expect(result).toContain('\n}\n\nextension AppDelegate: UNUserNotificationCenterDelegate {}\n\nclass ReactNativeDelegate');
  });

  it('runs twice over its own output without writing anything twice', () => {
    for (const source of [bareAppDelegate, expoAppDelegate, rctAppDelegate]) {
      const once = addCarillonForwarding(source);

      expect(addCarillonForwarding(once)).toBe(once);
    }
  });

  it('writes only the registration callbacks when the delegate belongs to another library', () => {
    const result = addCarillonForwarding(expoAppDelegate, { installNotificationCenterDelegate: false });

    expect(result).toContain('CarillonBridge.didRegister(token: deviceToken)');
    expect(result).not.toContain('userNotificationCenter');
    expect(result).not.toContain('UNUserNotificationCenter.current().delegate');
    expect(result).not.toContain('UNUserNotificationCenterDelegate');
    expect(addCarillonForwarding(result, { installNotificationCenterDelegate: false })).toBe(result);
  });

  it('refuses a file it cannot recognise', () => {
    expect(() => addCarillonForwarding('// no AppDelegate here\n')).toThrow('AppDelegate');
  });
});

describe('installNotificationCenterDelegate', () => {
  it('writes didFinishLaunching when the file has none, chaining to a base class that has it', () => {
    const result = installNotificationCenterDelegate('class AppDelegate: ExpoAppDelegate {\n}\n');

    expect(result).toContain('override func application(');
    expect(result).toContain('UNUserNotificationCenter.current().delegate = self\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
  });

  it('returns true itself when there is no base class to chain to', () => {
    const result = installNotificationCenterDelegate('class AppDelegate: UIResponder, UIApplicationDelegate {\n}\n');

    expect(result).not.toContain('override');
    expect(result).toContain('UNUserNotificationCenter.current().delegate = self\n    return true');
  });
});

describe('addNotificationCenterConformance', () => {
  it('leaves a class that already conforms alone', () => {
    const source = 'class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {\n}\n';

    expect(addNotificationCenterConformance(source)).toBe(source);
  });
});

describe('setApsEnvironment', () => {
  it('declares the push entitlement without disturbing the others', () => {
    expect(setApsEnvironment({ 'com.apple.security.application-groups': [] })).toEqual({
      'com.apple.security.application-groups': [],
      'aps-environment': 'development',
    });
  });
});

describe('addMessagingService', () => {
  const service = {
    $: { 'android:name': 'dev.carillon.sdk.CarillonMessagingService', 'android:exported': 'false' },
    'intent-filter': [
      { action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] },
    ],
  };

  it('declares the SDK service in an application that has none', () => {
    expect(addMessagingService({ $: { 'android:name': '.MainApplication' } })).toEqual({
      $: { 'android:name': '.MainApplication' },
      service: [service],
    });
  });

  it('keeps a service the app already brought', () => {
    // Firebase dispatches to one service per application, so a second
    // declaration means one of them silently never runs.
    const theirs = {
      $: { 'android:name': '.TheirMessagingService' },
      'intent-filter': [
        { action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] },
      ],
    };
    const application = { $: { 'android:name': '.MainApplication' }, service: [theirs] };

    expect(addMessagingService(application)).toBe(application);
  });

  it('adds nothing twice', () => {
    const once = addMessagingService({ $: { 'android:name': '.MainApplication' } });

    expect(addMessagingService(once)).toBe(once);
  });
});

describe('resolveMessagingService', () => {
  const messagingManifest = (service: string) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <service android:name="${service}" android:exported="false">
      <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
      </intent-filter>
    </service>
  </application>
</manifest>`;
  const plainManifest = '<manifest><application /></manifest>';

  const projectWith = (packages: Record<string, string | null>) => {
    const root = mkdtempSync(join(tmpdir(), 'carillon-plugin-'));
    for (const [name, manifest] of Object.entries(packages)) {
      const folder = join(root, 'node_modules', name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'package.json'), '{}');
      if (manifest !== null) {
        mkdirSync(join(folder, 'android', 'src', 'main'), { recursive: true });
        writeFileSync(join(folder, 'android', 'src', 'main', 'AndroidManifest.xml'), manifest);
      }
    }
    return root;
  };

  it('declares the service in auto mode when no installed package declares one', () => {
    const root = projectWith({ 'js-only-library': null, 'native-library': plainManifest });

    expect(resolveMessagingService('auto', root)).toEqual({ declare: true, conflicts: [] });
  });

  it('steps aside in auto mode when an installed package declares its own service', () => {
    // A library's service only appears at manifest merge, after the plugin has
    // run, so the app manifest cannot reveal it; the installed manifests can.
    const root = projectWith({ '@acme/push-library': messagingManifest('com.acme.PushService') });

    expect(resolveMessagingService('auto', root)).toEqual({
      declare: false,
      conflicts: ['@acme/push-library'],
    });
  });

  it('finds a package hoisted to a parent node_modules', () => {
    const root = projectWith({ 'hoisted-library': messagingManifest('com.example.Messaging') });

    expect(resolveMessagingService('auto', join(root, 'apps', 'mobile')).declare).toBe(false);
  });

  it('does not count a library that declares the Carillon service itself', () => {
    const root = projectWith({
      'carillon-wrapper': messagingManifest('dev.carillon.sdk.CarillonMessagingService'),
    });

    expect(resolveMessagingService('auto', root).declare).toBe(true);
  });

  it('skips package manager metadata folders', () => {
    const root = projectWith({ '.store': messagingManifest('com.example.Hidden') });

    expect(resolveMessagingService('auto', root).declare).toBe(true);
  });

  it('declares regardless in carillon mode and never in external mode', () => {
    const root = projectWith({ 'push-library': messagingManifest('com.example.Push') });

    expect(resolveMessagingService('carillon', root)).toEqual({ declare: true, conflicts: [] });
    expect(resolveMessagingService('external', projectWith({}))).toEqual({
      declare: false,
      conflicts: [],
    });
  });
});

describe('the google-services wiring', () => {
  const projectGradle = `buildscript {
    dependencies {
        classpath("com.android.tools.build:gradle")
    }
}
`;

  it('adds the plugin to the classpath', () => {
    expect(addGoogleServicesClasspath(projectGradle)).toContain(
      'classpath("com.google.gms:google-services:'
    );
  });

  it('adds the classpath once', () => {
    const once = addGoogleServicesClasspath(projectGradle);

    expect(addGoogleServicesClasspath(once)).toBe(once);
  });

  it('applies the plugin only where the file it reads exists', () => {
    // A fresh clone with no google-services.json still builds, and push lights
    // up the moment the file is dropped in.
    const result = applyGoogleServicesPlugin('apply plugin: "com.android.application"\n');

    expect(result).toContain('if (file("google-services.json").exists())');
    expect(result).toContain('apply plugin: "com.google.gms.google-services"');
  });

  it('applies the plugin once', () => {
    const once = applyGoogleServicesPlugin('apply plugin: "com.android.application"\n');

    expect(applyGoogleServicesPlugin(once)).toBe(once);
  });
});

describe("Android notification opens", () => {
  const activity = `package dev.example

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
    keepExistingBehavior()
  }
}`;

  it("forwards cold and warm opens after their super calls", () => {
    const result = addAndroidOpenForwarding(activity);
    expect(result).toContain(
      "super.onCreate(null)\n    Carillon.didOpen(intent)",
    );
    expect(result).toContain(
      "super.onNewIntent(intent)\n    setIntent(intent)\n    Carillon.didOpen(intent)",
    );
    expect(result).toContain("keepExistingBehavior()");
    expect(result).toContain("import dev.carillon.sdk.Carillon");
    expect(addAndroidOpenForwarding(result)).toBe(result);
  });

  it("keeps an existing onNewIntent and setIntent with a different parameter name", () => {
    const input = activity.replace(
      "  override fun onCreate",
      `  override fun onNewIntent(incoming: android.content.Intent) {
    super.onNewIntent(incoming)
    setIntent(incoming)
    keepWarmBehavior()
  }
  override fun onCreate`,
    );
    const result = addAndroidOpenForwarding(input);
    expect(result).toContain(
      "setIntent(incoming)\n    Carillon.didOpen(incoming)",
    );
    expect(result.match(/override fun onNewIntent/g)).toHaveLength(1);
    expect(result.match(/setIntent\(incoming\)/g)).toHaveLength(1);
    expect(result).toContain("keepWarmBehavior()");
    expect(addAndroidOpenForwarding(result)).toBe(result);
  });

  it("adds a missing callback even when the other is already forwarded", () => {
    const result = addAndroidOpenForwarding(
      activity.replace(
        "super.onCreate(null)",
        "super.onCreate(null)\n    Carillon.didOpen(intent)",
      ),
    );
    expect(result.match(/Carillon.didOpen\(/g)).toHaveLength(2);
    expect(result).toContain("override fun onNewIntent");
  });

  it("keeps the package declaration before new imports", () => {
    const result = addAndroidOpenForwarding(
      "package dev.example\n\nclass MainActivity : ReactActivity() {}",
    );
    expect(
      result.startsWith(
        "package dev.example\n\nimport dev.carillon.sdk.Carillon",
      ),
    ).toBe(true);
    expect(addAndroidOpenForwarding(result)).toBe(result);
  });

  it("refuses Java and unrecognized callback structure explicitly", () => {
    expect(() =>
      addAndroidOpenForwarding("class MainActivity {}", "java"),
    ).toThrow("Kotlin");
    expect(() => addAndroidOpenForwarding("class OtherActivity {}")).toThrow(
      "MainActivity",
    );
    expect(() =>
      addAndroidOpenForwarding(activity.replace("super.onCreate(null)", "")),
    ).toThrow("super.onCreate");
  });
});


describe('foreground forwarding', () => {
  it('inserts a single callback even when older forwarding already exists', () => {
    const result = addForegroundForwarding(addCarillonForwarding(expoAppDelegate));
    expect(result).toContain('CarillonBridge.willPresent(notification, completionHandler: completionHandler)');
    expect(addForegroundForwarding(result)).toBe(result);
  });
  it('preserves an existing callback for other notification providers', () => {
    const source = `class AppDelegate: ExpoAppDelegate {
      override func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completion: @escaping (UNNotificationPresentationOptions) -> Void) {
        completion([.sound])
      }
    }`;
    const result = addForegroundForwarding(source);
    expect(result).toContain('CarillonBridge.willPresent(notification, completionHandler: completion)');
    expect(result).toContain('completion([.sound])');
    expect(addForegroundForwarding(result)).toBe(result);
  });
});


describe('notification service extension', () => {
  const xcode = require('xcode');
  const path = require('node:path');
  const { addNotificationExtension, EXTENSION_NAME, swiftPackageSource } = require('../extension');
  const exampleProject = () => {
    const project = xcode.project(path.join(__dirname, '../../../example/ios/CarillonExample.xcodeproj/project.pbxproj'));
    project.parseSync();
    delete project.hash.project.objects.PBXTargetDependency;
    delete project.hash.project.objects.PBXContainerItemProxy;
    return project;
  };

  it('resolves the Swift package from the environment as the podspec does', () => {
    expect(swiftPackageSource({})).toEqual({ kind: 'remote', minimumVersion: '0.2.1' });
    expect(swiftPackageSource({ CARILLON_SWIFT_PATH: '/checkouts/carillon-swift' })).toEqual({
      kind: 'local',
      path: '/checkouts/carillon-swift',
    });
  });

  it('references a local checkout relative to the ios directory', () => {
    const project = exampleProject();
    const checkout = path.resolve(__dirname, '../../../../carillon-swift');
    addNotificationExtension(project, 'dev.carillon.example', { kind: 'local', path: checkout });
    const written = project.writeSync();
    expect(written).toContain('isa = XCLocalSwiftPackageReference');
    expect(written).toContain('relativePath = "../../../carillon-swift"');
    expect(written).not.toContain('carillon-swift.git');
  });

  it('embeds one extension and links its Swift product idempotently', () => {
    const project = exampleProject();
    addNotificationExtension(project, 'dev.carillon.example', { kind: 'remote', minimumVersion: '0.2.0' });
    const first = project.writeSync();
    expect(first).toContain('isa = XCRemoteSwiftPackageReference');
    expect(first).toContain('minimumVersion = 0.2.0');
    expect(first).toContain('dev.carillon.example.CarillonNotificationExtension');
    expect(first).toContain('com.apple.product-type.app-extension');
    expect(first).toContain('XCSwiftPackageProductDependency');
    expect(first).toContain('NotificationService.swift');
    expect(first).toContain('CarillonNotificationExtension.appex');
    const targets = Object.values(project.pbxNativeTargetSection()).filter((target: unknown) => (target as { name?: string }).name === `"${EXTENSION_NAME}"`);
    expect(targets).toHaveLength(1);
    const objects = project.hash.project.objects;
    const dependencies = project.getFirstTarget().firstTarget.dependencies;
    expect(dependencies.some((reference: { value: string }) => objects.PBXTargetDependency[reference.value]?.target)).toBe(true);
    expect(first).toContain('SDKROOT = iphoneos');
    expect(first).toContain('PRODUCT_MODULE_NAME = CarillonNotificationService');
    expect(first).not.toContain('path = undefined');
    addNotificationExtension(project, 'dev.carillon.example', { kind: 'remote', minimumVersion: '0.2.0' });
    expect(project.writeSync()).toBe(first);
  });
});
