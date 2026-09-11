import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * A native module that answers, so that this file can assert what the bridge
 * sends it and nothing more. Everything the SDK actually does is tested where
 * it is implemented — in carillon-swift and carillon-kotlin — and duplicating
 * any of it here would be asserting a second implementation into existence.
 */
type Listener = (event: unknown) => void;

const mockNative = {
  listeners: [] as Listener[],
  /** What a cold start leaves waiting: an open with nobody yet attached. */
  held: [] as unknown[],
  calls: [] as string[],

  receivedListeners: [] as Listener[],
  onReceived(listener: Listener) {
    mockNative.receivedListeners.push(listener);
    return { remove: () => { mockNative.receivedListeners = mockNative.receivedListeners.filter((item) => item !== listener); } };
  },
  startObservingReceived: jest.fn(),
  stopObservingReceived: jest.fn(),
  finishReceived: jest.fn(),
  clearNotifications: jest.fn(),
  deviceListeners: [] as Listener[],
  onDeviceIdChanged(listener: Listener) {
    mockNative.deviceListeners.push(listener);
    return { remove: () => { mockNative.deviceListeners = mockNative.deviceListeners.filter((item) => item !== listener); } };
  },
  startObservingDeviceId: jest.fn(() => { mockNative.deviceListeners.forEach((listener) => listener({deviceId: 'first'})); }),
  configure: jest.fn(),
  requestPermission: jest.fn(async () => 'allowed'),
  getPermission: jest.fn(async () => 'undetermined'),
  canRequestPermission: jest.fn(async () => true),
  openNotificationSettings: jest.fn(),
  didOpen: jest.fn(),
  didReceive: jest.fn(),
  didRotateToken: jest.fn(),
  identify: jest.fn(),
  clearIdentity: jest.fn(),
  setTags: jest.fn(),
  optIn: jest.fn(),
  optOut: jest.fn(),
  debugInfo: jest.fn(async () => ({ sdk_version: '0.1.0' })),

  onOpened(listener: Listener) {
    mockNative.calls.push('onOpened');
    mockNative.listeners.push(listener);

    return {
      remove: () => {
        mockNative.listeners = mockNative.listeners.filter(
          (attached) => attached !== listener
        );
      },
    };
  },

  /** The natives hand over what they were holding when a handler is installed. */
  startObservingOpens() {
    mockNative.calls.push('startObservingOpens');

    const waiting = mockNative.held;
    mockNative.held = [];
    waiting.forEach((event) => mockNative.emit(event));
  },

  emit(event: unknown) {
    mockNative.listeners.forEach((listener) => listener(event));
  },
};

jest.mock('../NativeCarillon', () => ({
  __esModule: true,
  default: mockNative,
}));

const Carillon = require('../index').default as typeof import('../index').default;

const anOpen = {
  deliveryId: '01937b1e-0000-7000-8000-000000000001',
  openedAt: '2026-08-05T14:00:00.000Z',
  payload: { carillon: { delivery_id: '01937b1e-0000-7000-8000-000000000001' } },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.listeners = [];
  mockNative.held = [];
  mockNative.calls = [];
});

describe('configure', () => {
  it('spreads the options object into the arguments the natives take', () => {
    Carillon.configure({
      key: 'carillon_mk_test_key',
      endpoint: 'http://localhost:28080',
      debug: true,
    });

    expect(mockNative.configure).toHaveBeenCalledWith(
      'carillon_mk_test_key',
      'http://localhost:28080',
      true
    );
  });

  it('leaves an absent endpoint absent rather than inventing production', () => {
    // The default belongs to the natives, which is the only place it is written
    // down. A default repeated here is a default that can drift.
    Carillon.configure({ key: 'carillon_mk_live_key' });

    expect(mockNative.configure).toHaveBeenCalledWith(
      'carillon_mk_live_key',
      undefined,
      undefined
    );
  });
});

describe('requestPermission', () => {
  it('answers with the permission the natives reported', async () => {
    mockNative.requestPermission.mockResolvedValueOnce('denied');

    await expect(Carillon.requestPermission()).resolves.toBe('denied');
  });

  it('does not register anything: configure already did', () => {
    // The bridge has one call for one question. A device is in the customer's
    // base from `configure`, prompt or no prompt, and nothing here changes that.
    Carillon.configure({ key: 'carillon_mk_test_key' });

    expect(mockNative.configure).toHaveBeenCalled();
    expect(mockNative.requestPermission).not.toHaveBeenCalled();
  });
});

describe('permission state', () => {
  it('reads the permission without prompting', async () => {
    await expect(Carillon.getPermission()).resolves.toBe('undetermined');
    expect(mockNative.requestPermission).not.toHaveBeenCalled();
  });

  it('asks the natives whether the prompt would show, and opens settings', async () => {
    mockNative.canRequestPermission.mockResolvedValueOnce(false);

    await expect(Carillon.canRequestPermission()).resolves.toBe(false);

    Carillon.openNotificationSettings();

    expect(mockNative.openNotificationSettings).toHaveBeenCalledTimes(1);
  });
});

describe('forwarding from another notification library', () => {
  it('hands payloads and tokens to the natives unchanged', () => {
    // Nothing is normalised here: iOS wants the userInfo as it arrived, and the
    // Android module stringifies values itself, the way FCM would have.
    const payload = { carillon: { delivery_id: anOpen.deliveryId }, order_id: 42 };

    Carillon.didOpen(payload);
    Carillon.didReceive(payload);
    Carillon.didRotateToken('fcm-token');

    expect(mockNative.didOpen).toHaveBeenCalledWith(payload);
    expect(mockNative.didReceive).toHaveBeenCalledWith(payload);
    expect(mockNative.didRotateToken).toHaveBeenCalledWith('fcm-token');
  });
});

describe('identify', () => {
  it('forwards an identifier', () => {
    Carillon.identify('user-42');

    expect(mockNative.identify).toHaveBeenCalledWith('user-42');
    expect(mockNative.clearIdentity).not.toHaveBeenCalled();
  });

  it('reads null as the natives already spell it, clearIdentity', () => {
    Carillon.identify(null);

    expect(mockNative.clearIdentity).toHaveBeenCalled();
    expect(mockNative.identify).not.toHaveBeenCalled();
  });
});

describe('the state the app sets', () => {
  it('sends the tag map whole', () => {
    Carillon.setTags({ plan: 'pro', seats: 12, trial: false });

    expect(mockNative.setTags).toHaveBeenCalledWith({
      plan: 'pro',
      seats: 12,
      trial: false,
    });
  });

  it('forwards optIn and optOut', () => {
    Carillon.optIn();
    Carillon.optOut();

    expect(mockNative.optIn).toHaveBeenCalledTimes(1);
    expect(mockNative.optOut).toHaveBeenCalledTimes(1);
  });
});

describe('onOpened', () => {
  it('normalizes the Android stamp without changing customer data or the native event', () => {
    const seen: unknown[] = [];
    Carillon.onOpened((notification) => seen.push(notification));
    const stamp = { delivery_id: anOpen.deliveryId, image: 'https://example.com/image.png' };
    const event = { ...anOpen, payload: { order_id: '42', carillon: JSON.stringify(stamp) } };
    mockNative.emit(event);
    expect(seen).toEqual([{ ...event, payload: { order_id: '42', carillon: stamp } }]);
    expect(typeof event.payload.carillon).toBe('string');
  });

  it.each(['invalid', 'null', '[]', '42'])('preserves malformed stamps: %s', (carillon) => {
    const seen: unknown[] = [];
    Carillon.onOpened((notification) => seen.push(notification));
    const event = { ...anOpen, payload: { carillon } };
    mockNative.emit(event);
    expect(seen).toEqual([event]);
  });

  it('hands the whole payload over', () => {
    const seen: unknown[] = [];
    Carillon.onOpened((notification) => seen.push(notification));

    mockNative.emit(anOpen);

    expect(seen).toEqual([anOpen]);
  });

  it('attaches before asking the natives to speak, so a cold start lands', () => {
    // The tap that launched the app is waiting inside the native. It is released
    // when the handler is installed, and the listener has to be there already —
    // this is the whole reason the two calls are in the order they are in.
    mockNative.held = [anOpen];

    const seen: unknown[] = [];
    Carillon.onOpened((notification) => seen.push(notification));

    expect(seen).toEqual([anOpen]);
    expect(mockNative.calls).toEqual(['onOpened', 'startObservingOpens']);
  });

  it('stops delivering once unsubscribed', () => {
    const seen: unknown[] = [];
    const off = Carillon.onOpened((notification) => seen.push(notification));

    off();
    mockNative.emit(anOpen);

    expect(seen).toEqual([]);
  });

  it('delivers to every subscriber, and removes only the one asked for', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];

    const off = Carillon.onOpened((notification) => first.push(notification));
    Carillon.onOpened((notification) => second.push(notification));

    off();
    mockNative.emit(anOpen);

    expect(first).toEqual([]);
    expect(second).toEqual([anOpen]);
  });
});

describe('debugInfo', () => {
  it('passes the natives own value through unopened', async () => {
    await expect(Carillon.debugInfo()).resolves.toEqual({
      sdk_version: '0.1.0',
    });
  });
});


it('attaches device ID listeners before native observation and removes them', () => {
  const changes: string[] = [];
  const off = Carillon.onDeviceIdChanged((id) => changes.push(id));
  expect(changes).toEqual(['first']);
  off();
  mockNative.deviceListeners.forEach((listener) => listener({deviceId: 'second'}));
  expect(changes).toEqual(['first']);
});

it('returns null until a device ID has been confirmed', async () => {
  expect(await Carillon.getDeviceId()).toBeNull();
});


describe('foreground presentation', () => {
  const event = { requestId: 'request', deliveryId: 'delivery', title: 'Hello', body: 'Message', data: { url: '/chat' }, image: null, threadId: 'chat' };
  it('forwards an asynchronous suppress decision and removes the listener', async () => {
    const handler = jest.fn(async () => 'suppress' as const);
    const remove = Carillon.onReceived(handler);
    mockNative.receivedListeners.forEach((listener) => listener(event));
    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledWith({ deliveryId: 'delivery', title: 'Hello', body: 'Message', data: { url: '/chat' }, image: null, threadId: 'chat' });
    expect(mockNative.finishReceived).toHaveBeenCalledWith('request', 'suppress');
    remove();
    expect(mockNative.receivedListeners).toHaveLength(0);
    expect(mockNative.stopObservingReceived).toHaveBeenCalled();
  });
  it('falls back to show if the handler throws', async () => {
    const remove = Carillon.onReceived(() => { throw new Error('broken app handler'); });
    mockNative.receivedListeners.forEach((listener) => listener(event));
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockNative.finishReceived).toHaveBeenCalledWith('request', 'show');
    remove();
  });
  it('replaces the handler and ignores an older unsubscribe', () => {
    const old = Carillon.onReceived(() => 'suppress');
    const current = Carillon.onReceived(() => 'show');
    mockNative.stopObservingReceived.mockClear();
    old();
    expect(mockNative.stopObservingReceived).not.toHaveBeenCalled();
    expect(mockNative.receivedListeners).toHaveLength(1);
    current();
    Carillon.clearNotifications();
    expect(mockNative.clearNotifications).toHaveBeenCalled();
  });
});
