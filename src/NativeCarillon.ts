import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/**
 * The native surface, as codegen sees it.
 *
 * Deliberately flatter than the surface in `index.tsx`: arguments are scalars
 * and results are plain values, because every shape crossing this boundary has
 * to exist three times — here, in Objective-C++ and in Kotlin — and a shape
 * that exists once, in TypeScript, is a shape that cannot disagree with itself.
 * Turning an options object into arguments and an outcome into a result is what
 * the JavaScript layer is for.
 */
export interface Spec extends TurboModule {
  configure(key: string, endpoint?: string, debug?: boolean): void;

  /**
   * The permission the person left the system dialogue in, spelled as the
   * natives spell it: allowed, denied, provisional, undetermined.
   *
   * No activity crosses this boundary. Android needs one to raise a dialogue
   * and the module has `currentActivity`; making JavaScript supply it would put
   * a platform's plumbing into a surface that has none.
   */
  requestPermission(): Promise<string>;

  identify(externalId: string): void;
  clearIdentity(): void;
  setTags(tags: CodegenTypes.UnsafeObject): void;
  optIn(): void;
  optOut(): void;

  /** Whatever the native answers, unopened. */
  debugInfo(): Promise<CodegenTypes.UnsafeObject>;

  /**
   * Installs the native open handler, which is what makes the native hand over
   * the opens it has been holding.
   *
   * Separate from `onOpened` because a subscription and a replay are not the
   * same event: an app launched by a tap has its open waiting in the native
   * before any JavaScript exists, and the native releases it to whoever is
   * listening at the moment this is called. Emitting on module construction
   * instead would deliver that tap — the one that matters most — into a
   * runtime with nobody attached. Idempotent, so every subscriber may call it.
   */
  startObservingOpens(): void;

  /**
   * An opened notification, whole.
   *
   * `UnsafeObject` rather than a struct: the payload is the customer's own, of
   * a shape only they know, and codegen cannot describe a value whose keys are
   * not ours. `OpenedNotification` in `index.tsx` is the shape this carries.
   */
  readonly onOpened: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Carillon');
