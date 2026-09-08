import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/**
 * Native codegen interface. The JavaScript wrapper maps options to scalar arguments.
 */
export interface Spec extends TurboModule {
  configure(key: string, endpoint?: string, debug?: boolean): void;

  /**
 * Returns allowed, denied, provisional, or undetermined.
 * The Android module supplies the activity for the permission request.
 */
  requestPermission(): Promise<string>;

  identify(externalId: string): void;
  clearIdentity(): void;
  setTags(tags: CodegenTypes.UnsafeObject): void;
  optIn(): void;
  optOut(): void;

  /**
 * Native diagnostic fields.
 */
  debugInfo(): Promise<CodegenTypes.UnsafeObject>;

  /**
 * Installs the native handler and replays buffered opens.
 * Attach the JavaScript listener first to avoid losing cold-start events. Idempotent.
 */
  startObservingOpens(): void;

  /**
 * OpenedNotification payload. UnsafeObject allows application-defined payload keys.
 */
  readonly onOpened: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Carillon');
