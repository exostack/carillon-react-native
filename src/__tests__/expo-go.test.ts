import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const runtime = globalThis as typeof globalThis & {
  expo?: { modules?: { ExpoGo?: unknown } };
};
const originalExpo = runtime.expo;
const get = jest.fn<() => unknown>();
const nativeModules: { ExponentConstants?: { appOwnership: string } } = {};
let warning: ReturnType<typeof jest.spyOn>;

function load() {
  return (require('../index') as typeof import('../index')).default;
}

beforeEach(() => {
  jest.resetModules();
  get.mockReset().mockReturnValue(null);
  delete runtime.expo;
  delete nativeModules.ExponentConstants;
  jest.doMock('react-native', () => ({
    TurboModuleRegistry: { get },
    NativeModules: nativeModules,
  }));
  warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warning.mockRestore();
  runtime.expo = originalExpo;
});

describe('Expo Go', () => {
  it('imports and safely handles the public API without a native module', async () => {
    runtime.expo = { modules: { ExpoGo: {} } };
    const sdk = load();
    sdk.configure({ key: 'test' });
    sdk.configure({ key: 'test' });
    sdk.identify('user');
    sdk.identify(null);
    sdk.setTags({ plan: 'pro' });
    sdk.setTag('plan', 'pro');
    sdk.setTagNumber('score', 1.5);
    sdk.setTagBoolean('subscribed', false);
    sdk.setTagDate('expires', new Date('2026-10-01T00:00:00Z'));
    sdk.removeTag('plan');
    sdk.removeTagNumber('score');
    sdk.removeTagBoolean('subscribed');
    sdk.removeTagDate('expires');
    sdk.optIn();
    sdk.optOut();
    sdk.openNotificationSettings();
    sdk.clearNotifications();
    sdk.didOpen({});
    sdk.didReceive({});
    sdk.didRotateToken('token');
    const handler = jest.fn(() => 'show' as const);
    const offOpened = sdk.onOpened(handler);
    const offDevice = sdk.onDeviceIdChanged(handler);
    const offReceived = sdk.onReceived(handler);
    sdk.onReceived(handler)();
    offOpened();
    offDevice();
    offReceived();
    expect(handler).not.toHaveBeenCalled();
    await expect(sdk.requestPermission()).resolves.toBe('undetermined');
    await expect(sdk.getPermission()).resolves.toBe('undetermined');
    await expect(sdk.canRequestPermission()).resolves.toBe(false);
    await expect(sdk.getDeviceId()).resolves.toBeNull();
    await expect(sdk.debugInfo()).resolves.toEqual({
      available: false, reason: 'expo_go', device_id: null,
    });
    expect(load()).toBe(sdk);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Expo Go'));
    expect(() => sdk.setTagNumber('score', NaN)).toThrow();
  });

  it('recognizes legacy Expo Go ownership', () => {
    nativeModules.ExponentConstants = { appOwnership: 'expo' };
    expect(() => load()).not.toThrow();
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it.each(['standalone', 'guest'])('rejects a missing module in %s builds', (appOwnership) => {
    nativeModules.ExponentConstants = { appOwnership };
    expect(() => load()).toThrow('Native module is missing');
    expect(warning).not.toHaveBeenCalled();
  });

  it('rejects a missing module in bare React Native', () => {
    expect(() => load()).toThrow('Native module is missing');
  });

  it('uses the real native module when present', () => {
    const configure = jest.fn();
    get.mockReturnValue({ configure });
    load().configure({ key: 'mobile-key' });
    expect(configure).toHaveBeenCalledWith('mobile-key', undefined, undefined);
    expect(warning).not.toHaveBeenCalled();
  });
});
