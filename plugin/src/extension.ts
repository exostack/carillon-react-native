import { withXcodeProject, type ConfigPlugin } from '@expo/config-plugins';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Project = Parameters<Parameters<typeof withXcodeProject>[1]>[0]['modResults'];
export const EXTENSION_NAME = 'CarillonNotificationExtension';
export const notificationService = `import UserNotifications
import CarillonNotificationExtension

final class NotificationService: UNNotificationServiceExtension {
  private var helper: CarillonNotificationExtension?

  override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
    helper = CarillonNotificationExtension.didReceive(request, withContentHandler: handler)
  }

  override func serviceExtensionTimeWillExpire() {
    CarillonNotificationExtension.serviceExtensionTimeWillExpire(helper)
  }
}
`;

export const extensionPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Notifications</string>
<key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
<key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
<key>NSExtension</key><dict>
<key>NSExtensionPointIdentifier</key><string>com.apple.usernotifications.service</string>
<key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).NotificationService</string>
</dict></dict></plist>
`;

export function addNotificationExtension(project: Project, bundleId: string): void {
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};
  const targets = project.pbxNativeTargetSection();
  const existing = Object.entries(targets).find(([, target]) => target !== null && typeof target === 'object' && 'name' in target && typeof target.name === 'string' && target.name.replaceAll('"', '') === EXTENSION_NAME);
  const app = project.getFirstTarget().firstTarget;
  const lists = objects.XCConfigurationList;
  const configs = project.pbxXCBuildConfigurationSection();
  const appConfigs = lists[app.buildConfigurationList].buildConfigurations;
  const target = existing ? { uuid: existing[0], pbxNativeTarget: targets[existing[0]] } : project.addTarget(EXTENSION_NAME, 'app_extension', EXTENSION_NAME, `${bundleId}.${EXTENSION_NAME}`);
  const targetConfigs = lists[target.pbxNativeTarget.buildConfigurationList].buildConfigurations;
  for (const reference of targetConfigs) {
    const config = configs[reference.value];
    const matching = appConfigs.find((entry: { value: string }) => configs[entry.value].name === config.name) ?? appConfigs[0];
    const settings = configs[matching.value].buildSettings;
    Object.assign(config.buildSettings, {
      IPHONEOS_DEPLOYMENT_TARGET: settings.IPHONEOS_DEPLOYMENT_TARGET ?? '15.1',
      SWIFT_VERSION: '5.0',
      SDKROOT: 'iphoneos',
      SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
      PRODUCT_MODULE_NAME: 'CarillonNotificationService',
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}.${EXTENSION_NAME}"`,
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      TARGETED_DEVICE_FAMILY: settings.TARGETED_DEVICE_FAMILY ?? '"1,2"',
      MARKETING_VERSION: settings.MARKETING_VERSION ?? '1.0',
      CURRENT_PROJECT_VERSION: settings.CURRENT_PROJECT_VERSION ?? '1',
      ...(settings.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: settings.DEVELOPMENT_TEAM } : {}),
    });
  }
  if (existing) {
    const parent = project.getFirstTarget();
    const dependencies = parent.firstTarget.dependencies ?? [];
    if (!dependencies.some((reference: { value: string }) => objects.PBXTargetDependency[reference.value]?.target === target.uuid)) project.addTargetDependency(parent.uuid, [target.uuid]);
    return;
  }
  const source = `${EXTENSION_NAME}/NotificationService.swift`;
  project.addBuildPhase([source], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  const group = project.addPbxGroup([source], EXTENSION_NAME, '.');
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  const frameworks = project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  const packageId = project.generateUuid();
  const productId = project.generateUuid();
  const buildId = project.generateUuid();
  objects.XCRemoteSwiftPackageReference ??= {};
  objects.XCSwiftPackageProductDependency ??= {};
  objects.XCRemoteSwiftPackageReference[packageId] = {
    isa: 'XCRemoteSwiftPackageReference',
    repositoryURL: '"https://github.com/exostack/carillon-swift.git"',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '0.2.0' },
  };
  objects.XCSwiftPackageProductDependency[productId] = {
    isa: 'XCSwiftPackageProductDependency', package: packageId, productName: EXTENSION_NAME,
  };
  objects.PBXBuildFile[buildId] = { isa: 'PBXBuildFile', productRef: productId };
  frameworks.buildPhase.files.push({ value: buildId, comment: `${EXTENSION_NAME} in Frameworks` });
  target.pbxNativeTarget.packageProductDependencies = [{ value: productId, comment: EXTENSION_NAME }];
  const root = project.getFirstProject().firstProject;
  root.packageReferences ??= [];
  root.packageReferences.push({ value: packageId, comment: 'carillon-swift' });
}

export const withNotificationExtension: ConfigPlugin = (config) => {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('Set ios.bundleIdentifier before configuring Carillon notifications.');
  const eas = config.extra?.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const extensions = ios.appExtensions ?? [];
  config.extra = { ...config.extra, eas: { ...eas, build: { ...build, experimental: { ...experimental, ios: {
    ...ios, appExtensions: [
      ...extensions.filter((item: { targetName: string }) => item.targetName !== EXTENSION_NAME),
      { targetName: EXTENSION_NAME, bundleIdentifier: `${bundleId}.${EXTENSION_NAME}`, entitlements: {} },
    ],
  } } } } };
  return withXcodeProject(config, (mod) => {
    const folder = join(mod.modRequest.platformProjectRoot, EXTENSION_NAME);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'NotificationService.swift'), notificationService);
    writeFileSync(join(folder, `${EXTENSION_NAME}-Info.plist`), extensionPlist);
    addNotificationExtension(mod.modResults, bundleId);
    return mod;
  });
};
