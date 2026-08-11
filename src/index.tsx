import NativeCarillon from './NativeCarillon';

/**
 * The Carillon React Native SDK.
 *
 * A bridge and nothing else. Registration, retries, the event queue, the
 * environment the device is in, the open held across a cold start — all of it
 * lives in carillon-swift and carillon-kotlin, once, so that every wrapper over
 * them behaves the same way. Anything this file did on its own would be a
 * second implementation of a protocol that already has one.
 *
 * ```ts
 * Carillon.configure({ key: 'carillon_mk_live_…', debug: __DEV__ });
 * await Carillon.register();
 * const off = Carillon.onOpened((n) => router.push(n.payload.url));
 * ```
 */

/** What `configure` takes. `endpoint` is for staging, and for nothing else. */
export type CarillonOptions = {
  /**
   * A mobile key, `carillon_mk_live_…` or `carillon_mk_test_…`. It is public by
   * construction — it ships inside this binary — which is why it can only
   * register this device and report this device's events.
   */
  key: string;
  endpoint?: string;
  /**
   * Verbose logging, honoured only in a debug build: the natives compile it out
   * of an iOS release and refuse it outside a debuggable Android application,
   * so a `true` left in shipped code logs nothing.
   */
  debug?: boolean;
};

/**
 * What `register()` resolved to.
 *
 * `simulator` is iOS's alone — an Android emulator with Play Services issues a
 * real token and receives real notifications, so there is nothing to warn
 * anybody about there.
 */
export type RegistrationStatus = 'registered' | 'denied' | 'simulator';

export type RegistrationResult = { status: RegistrationStatus };

/** A tag value, as the API defines it: a flat scalar and nothing else. */
export type TagValue = string | number | boolean;

/**
 * An open, handed to the app.
 *
 * The whole payload is here because the customer's own keys travel in it and
 * the destination of a tap is theirs to decide. Carillon carries the data and
 * takes no position on what it means.
 */
export type OpenedNotification = {
  /**
   * The proof of receipt. Unguessable, and it travelled inside this one
   * notification, which is what makes an open rate something that cannot be
   * manufactured.
   */
  deliveryId: string;
  /** When the tap happened, ISO-8601. */
  openedAt: string;
  /** Everything the notification carried, the reserved `carillon` key included. */
  payload: Record<string, unknown>;
};

export type OpenedHandler = (notification: OpenedNotification) => void;

/**
 * One value, made to be pasted into a support ticket: the natives' own, with
 * their own field names, unopened on the way through.
 */
export type DebugInfo = Record<string, unknown>;

/** Configures the SDK. Call once, early, before anything else. */
export function configure(options: CarillonOptions): void {
  NativeCarillon.configure(options.key, options.endpoint, options.debug);
}

/**
 * Asks for permission and registers the device.
 *
 * On iOS the token arrives later, on the delegate callback the app forwards; on
 * Android the SDK asks Firebase for it. Either way this answers about
 * permission, not about a token.
 */
export async function register(): Promise<RegistrationResult> {
  const status = await NativeCarillon.register();

  return { status: status as RegistrationStatus };
}

/**
 * Your own identifier for the person using this device, or `null` to forget it.
 *
 * An attribute of the device, never an entity: one person on two handsets is
 * two devices, and both carry the same identifier.
 */
export function identify(externalId: string | null): void {
  if (externalId === null) {
    NativeCarillon.clearIdentity();

    return;
  }

  NativeCarillon.identify(externalId);
}

/**
 * Replaces the tags whole.
 *
 * The natives hold the canonical map and the server replaces what they hold, so
 * this is the complete set every time.
 */
export function setTags(tags: Record<string, TagValue>): void {
  NativeCarillon.setTags(tags);
}

/** Opts the device back in. Notifications resume at the next send. */
export function optIn(): void {
  NativeCarillon.optIn();
}

/**
 * Opts the device out. The row stays, so the person can be opted back in, and
 * so the customer can still see that this handset exists.
 */
export function optOut(): void {
  NativeCarillon.optOut();
}

/**
 * Subscribes to opens. Returns the unsubscribe.
 *
 * The order of the two calls below is the whole of the cold-start case, and it
 * is the reverse of what reads naturally. An app launched by a tap has its open
 * waiting inside the native before any JavaScript has run; the native releases
 * what it is holding when the handler is installed, which is what
 * `startObservingOpens` does. Attaching the listener afterwards would arrive
 * after the replay it exists to catch.
 */
export function onOpened(handler: OpenedHandler): () => void {
  const subscription = NativeCarillon.onOpened((event) => {
    handler(event as OpenedNotification);
  });

  NativeCarillon.startObservingOpens();

  return () => {
    subscription.remove();
  };
}

/** One call, one value, made to be pasted into a support ticket. */
export async function debugInfo(): Promise<DebugInfo> {
  return (await NativeCarillon.debugInfo()) as DebugInfo;
}

const Carillon = {
  configure,
  register,
  identify,
  setTags,
  optIn,
  optOut,
  onOpened,
  debugInfo,
};

export default Carillon;
