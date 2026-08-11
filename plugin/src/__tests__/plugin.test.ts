import { describe, expect, it } from '@jest/globals';
import {
  addCarillonForwarding,
  addGoogleServicesClasspath,
  addImport,
  addMessagingService,
  applyGoogleServicesPlugin,
  needsOverride,
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

const expoAppDelegate = `import ExpoModulesCore

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  public override func application(
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
  it('is true against a base class that already implements the callbacks', () => {
    expect(needsOverride(expoAppDelegate)).toBe(true);
  });

  it('is false against a bare UIResponder, which implements none of them', () => {
    expect(needsOverride(bareAppDelegate)).toBe(false);
  });
});

describe('addCarillonForwarding', () => {
  it('forwards the three callbacks and imports what they need', () => {
    const result = addCarillonForwarding(bareAppDelegate);

    expect(result).toContain('import CarillonReactNative');
    expect(result).toContain('import UserNotifications');
    expect(result).toContain('CarillonBridge.didRegister(token: deviceToken)');
    expect(result).toContain('CarillonBridge.didFailToRegister(error)');
    expect(result).toContain('CarillonBridge.didOpen(response)');
  });

  it('leaves the existing body alone', () => {
    expect(addCarillonForwarding(bareAppDelegate)).toContain(
      'didFinishLaunchingWithOptions'
    );
  });

  it('closes the response itself when there is no base class to hand it to', () => {
    const result = addCarillonForwarding(bareAppDelegate);

    expect(result).toContain('completionHandler()');
    expect(result).not.toContain('override func');
    expect(result).not.toContain('super.userNotificationCenter');
  });

  it('overrides and calls super where a base class implements the callbacks', () => {
    // Nobody's callback disappears: that is the whole reason the SDK asks for
    // explicit forwarding instead of swizzling, and a plugin that wrote the
    // forwarding without the chain would take away exactly what it protects.
    const result = addCarillonForwarding(expoAppDelegate);

    expect(result).toContain('override func application(');
    expect(result).toContain(
      'super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)'
    );
    expect(result).toContain('super.userNotificationCenter(center, didReceive: response');
    expect(result).not.toContain('completionHandler()\n  }');
  });

  it('runs twice over its own output without writing anything twice', () => {
    const once = addCarillonForwarding(bareAppDelegate);

    expect(addCarillonForwarding(once)).toBe(once);
  });

  it('leaves a file it cannot recognise untouched', () => {
    expect(addCarillonForwarding('// no AppDelegate here\n')).toBe(
      '// no AppDelegate here\n'
    );
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
