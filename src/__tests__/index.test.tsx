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

  configure: jest.fn(),
  register: jest.fn(async () => 'registered'),
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

describe('register', () => {
  it('names the outcome the natives answered with', async () => {
    mockNative.register.mockResolvedValueOnce('denied');

    await expect(Carillon.register()).resolves.toEqual({ status: 'denied' });
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
