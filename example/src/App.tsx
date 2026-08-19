import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Carillon, { type DebugInfo } from '@exostack/carillon-react-native';

/**
 * The test bench.
 *
 * A tool, not a product: every control here exists to exercise one call of the
 * SDK against a real server and show what came back. Nothing is styled beyond
 * legibility — anything that looked designed would be a claim about how the SDK
 * should be presented, which is the customer's decision and not ours.
 */

/**
 * The monorepo's local API. An Android emulator reaches the host machine
 * through 10.0.2.2 and nothing else; a simulator shares the host's loopback.
 */
const DEFAULT_ENDPOINT = Platform.select({
  android: 'http://10.0.2.2:28080',
  default: 'http://localhost:28080',
});

const ENDPOINT_KEY = 'bench.endpoint';
const MOBILE_KEY = 'bench.key';

export default function App() {
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [key, setKey] = useState('');
  const [externalId, setExternalId] = useState('');
  const [tagName, setTagName] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [info, setInfo] = useState<DebugInfo>({});
  const [lines, setLines] = useState<string[]>([]);

  /** Newest first: on a bench the interesting line is always the last thing
   * that happened, and scrolling to find it is the one thing a tool must not
   * ask for. */
  const append = useCallback((line: string) => {
    setLines((previous) => [line, ...previous].slice(0, 500));
  }, []);

  const refreshInfo = useCallback(async () => {
    setInfo(await Carillon.debugInfo());
  }, []);

  useEffect(() => {
    // Subscribed on the first render, which is as early as JavaScript exists.
    // An app launched by a tap has its open waiting inside the native until
    // exactly this moment.
    const off = Carillon.onOpened((notification) => {
      append(`opened ${notification.deliveryId}`);
      void refreshInfo();
    });

    return off;
  }, [append, refreshInfo]);

  useEffect(() => {
    void (async () => {
      const [storedEndpoint, storedKey] = await Promise.all([
        AsyncStorage.getItem(ENDPOINT_KEY),
        AsyncStorage.getItem(MOBILE_KEY),
      ]);

      setEndpoint(storedEndpoint ?? DEFAULT_ENDPOINT);
      setKey(storedKey ?? '');

      // Configure at launch, not only on Apply — the native benches do the
      // same in didFinishLaunching. Without this, a cold start from a
      // notification tap comes up on the defaults, and the opened event the
      // native replayed sits in the at-least-once queue until someone presses
      // Apply — which is exactly how this line earned its place.
      if (storedKey !== null) {
        Carillon.configure({
          key: storedKey,
          endpoint: storedEndpoint ?? DEFAULT_ENDPOINT,
          debug: true,
        });
        append(`configured at launch for ${storedEndpoint ?? DEFAULT_ENDPOINT}`);
        void refreshInfo();
      }
    })();
  }, [append, refreshInfo]);

  const apply = useCallback(async () => {
    await Promise.all([
      AsyncStorage.setItem(ENDPOINT_KEY, endpoint),
      AsyncStorage.setItem(MOBILE_KEY, key),
    ]);

    Carillon.configure({ key, endpoint, debug: true });
    append(`configured for ${endpoint} with ${key === '' ? 'no key' : key}`);
    append('registering silently — nothing is asked; watch device_id appear below');

    // The token reaches the natives a moment later, and the registration a
    // moment after that. Re-read on a delay so the panel shows the device the
    // server named rather than the emptiness before it.
    await refreshInfo();
    setTimeout(() => void refreshInfo(), 2000);
  }, [append, endpoint, key, refreshInfo]);

  const requestPermission = useCallback(async () => {
    const permission = await Carillon.requestPermission();

    append(`requestPermission() → ${permission}`);
    await refreshInfo();
  }, [append, refreshInfo]);

  const act = useCallback(
    async (line: string, action: () => void) => {
      action();
      append(line);
      await refreshInfo();
    },
    [append, refreshInfo]
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.column}>
        <Heading>Connection</Heading>
        <Field placeholder="Endpoint" value={endpoint} onChangeText={setEndpoint} />
        <Field placeholder="Mobile key" value={key} onChangeText={setKey} monospace />
        <Button title="Apply" onPress={() => void apply()} />

        <Heading>Permission</Heading>
        <Note>
          Apply registers this device on its own. This asks whether the system
          may show anything.
        </Note>
        <Button
          title="requestPermission()"
          onPress={() => void requestPermission()}
        />

        <Heading>Identity</Heading>
        <Field placeholder="external_id" value={externalId} onChangeText={setExternalId} />
        <Button
          title="identify()"
          onPress={() =>
            void act(`identify(${externalId})`, () => Carillon.identify(externalId))
          }
        />
        <Button
          title="identify(null)"
          onPress={() => void act('identify(null)', () => Carillon.identify(null))}
        />

        <Heading>Tags</Heading>
        <Field placeholder="name" value={tagName} onChangeText={setTagName} />
        <Field placeholder="value" value={tagValue} onChangeText={setTagValue} />
        {/* One pair at a time, sent as the whole map. The SDK replaces rather
            than merges, which the bench shows honestly rather than papering
            over by accumulating pairs of its own. */}
        <Button
          title="setTags()"
          onPress={() =>
            void act(`setTags({${tagName}: ${tagValue}})`, () =>
              Carillon.setTags({ [tagName]: tagValue })
            )
          }
        />
        <Button
          title="setTags({})"
          onPress={() => void act('setTags({})', () => Carillon.setTags({}))}
        />

        <Heading>Opt in</Heading>
        <Button title="optIn()" onPress={() => void act('optIn()', Carillon.optIn)} />
        <Button title="optOut()" onPress={() => void act('optOut()', Carillon.optOut)} />

        <Heading>debugInfo()</Heading>
        <Button title="refresh" onPress={() => void refreshInfo()} />
        <Text style={styles.dump} selectable>
          {JSON.stringify(info, null, 2)}
        </Text>

        <Heading>Log</Heading>
        <Text style={styles.dump} selectable>
          {lines.join('\n')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Heading({ children }: { children: string }) {
  return <Text style={styles.heading}>{children.toUpperCase()}</Text>;
}

function Note({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>;
}

function Field({
  placeholder,
  value,
  onChangeText,
  monospace,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  monospace?: boolean;
}) {
  return (
    <View style={styles.field}>
      <TextInput
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        style={monospace === true ? styles.monospaceInput : undefined}
      />
    </View>
  );
}

const monospace = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  screen: { flex: 1 },
  column: { padding: 16 },
  heading: { fontSize: 12, fontWeight: 'bold', paddingTop: 20, paddingBottom: 4 },
  note: { fontSize: 12, paddingBottom: 6 },
  field: { borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  monospaceInput: { fontFamily: monospace },
  dump: { fontFamily: monospace, fontSize: 11, paddingTop: 4 },
});
