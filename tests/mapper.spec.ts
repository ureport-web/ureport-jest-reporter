import { mapAssertionResult, mapToRelationPayload, mapStatus, formatDuration, detectPlatformVersion } from '../src/mapper';
import type { JestAssertionResult } from '../src/mapper';
import type { UReportJestReporterOptions } from '../src/config';

function makeAssertion(overrides: Partial<JestAssertionResult> = {}): JestAssertionResult {
  return {
    fullName: 'Auth > user can log in',
    title: 'user can log in',
    ancestorTitles: ['Auth'],
    status: 'passed',
    duration: 1234,
    failureMessages: [],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UReportJestReporterOptions> = {}): UReportJestReporterOptions {
  return {
    serverUrl: 'http://localhost',
    apiToken: 'test-token',
    product: 'MyApp',
    type: 'Unit',
    batchSize: 50,
    saveRelations: true,
    autoDetectPlatform: true,
    buildNumber: Date.now(),
    ...overrides,
  };
}

describe('formatDuration', () => {
  test.each([
    [0, '0ms'],
    [1, '1ms'],
    [999, '999ms'],
    [1_000, '1.0s'],
    [1_500, '1.5s'],
    [59_999, '60.0s'],
    [60_000, '1m 0s'],
    [90_000, '1m 30s'],
    [3_599_999, '59m 59s'],
    [3_600_000, '1h 0m'],
    [5_400_000, '1h 30m'],
  ] as const)('%ims → %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe('mapStatus', () => {
  test.each([
    ['passed', 'PASS'],
    ['failed', 'FAIL'],
    ['pending', 'SKIP'],
    ['skipped', 'SKIP'],
    ['todo', 'SKIP'],
    ['disabled', 'SKIP'],
  ] as const)('%s → %s', (status, expected) => {
    expect(mapStatus(status)).toBe(expected);
  });
});

describe('mapAssertionResult', () => {
  const testFilePath = '/project/tests/auth.test.ts';

  test('uses fullName as uid when no meta', () => {
    const assertion = makeAssertion();
    const payload = mapAssertionResult(assertion, testFilePath, 'build-1', null, makeOptions());
    expect(payload.uid).toBe('Auth > user can log in');
  });

  test('uses meta.uid when provided', () => {
    const assertion = makeAssertion();
    const payload = mapAssertionResult(assertion, testFilePath, 'build-1', { uid: 'auth-login-001' }, makeOptions());
    expect(payload.uid).toBe('auth-login-001');
  });

  test('sets name to assertion.fullName', () => {
    const assertion = makeAssertion({ fullName: 'Suite > my test' });
    const payload = mapAssertionResult(assertion, testFilePath, 'build-1', null, makeOptions());
    expect(payload.name).toBe('Suite > my test');
  });

  test('sets build to buildId', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-xyz', null, makeOptions());
    expect(payload.build).toBe('build-xyz');
  });

  test('is_rerun is always false', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', null, makeOptions());
    expect(payload.is_rerun).toBe(false);
  });

  test('status: passed → PASS', () => {
    const payload = mapAssertionResult(makeAssertion({ status: 'passed' }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.status).toBe('PASS');
  });

  test('status: failed → FAIL', () => {
    const payload = mapAssertionResult(makeAssertion({ status: 'failed', failureMessages: ['Expected 1 to be 2'] }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.status).toBe('FAIL');
  });

  test('status: skipped → SKIP', () => {
    const payload = mapAssertionResult(makeAssertion({ status: 'skipped' }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.status).toBe('SKIP');
  });

  test('sets failure when failed', () => {
    const messages = ['Expected 1 to be 2', 'at line 10'];
    const assertion = makeAssertion({ status: 'failed', failureMessages: messages });
    const payload = mapAssertionResult(assertion, testFilePath, 'build-1', null, makeOptions());
    expect(payload.failure?.error_message).toBe('Expected 1 to be 2');
    expect(payload.failure?.stack_trace).toBe('Expected 1 to be 2\nat line 10');
  });

  test('no failure when passed', () => {
    const payload = mapAssertionResult(makeAssertion({ status: 'passed' }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.failure).toBeUndefined();
  });

  test('info.file is the basename of testFilePath', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', null, makeOptions());
    expect(payload.info?.file).toBe('auth.test.ts');
  });

  test('info.duration is formatted', () => {
    const payload = mapAssertionResult(makeAssertion({ duration: 4200 }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.info?.duration).toBe('4.2s');
  });

  test('info.duration is 0ms when assertion.duration is null', () => {
    const payload = mapAssertionResult(makeAssertion({ duration: null }), testFilePath, 'build-1', null, makeOptions());
    expect(payload.info?.duration).toBe('0ms');
  });

  test('meta.tags are added to info', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { tags: ['smoke', 'p1'] }, makeOptions());
    expect(payload.info?.tags).toEqual(['smoke', 'p1']);
  });

  test('meta.components are added to info', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { components: ['Auth', 'Login'] }, makeOptions());
    expect(payload.info?.components).toEqual(['Auth', 'Login']);
  });

  test('meta.teams are added to info', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { teams: ['Backend'] }, makeOptions());
    expect(payload.info?.teams).toEqual(['Backend']);
  });

  test('custom meta fields go into info', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { jira: 'PROJ-123', owner: 'alice' }, makeOptions());
    expect(payload.info?.['jira']).toBe('PROJ-123');
    expect(payload.info?.['owner']).toBe('alice');
  });

  test('meta uid is not added as a custom info field', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { uid: 'TC-001' }, makeOptions());
    expect(payload.info?.['uid']).toBeUndefined();
  });

  test('empty tags array is not added to info', () => {
    const payload = mapAssertionResult(makeAssertion(), testFilePath, 'build-1', { tags: [] }, makeOptions());
    expect(payload.info?.tags).toBeUndefined();
  });

  test('start_time is before end_time', () => {
    const payload = mapAssertionResult(makeAssertion({ duration: 500 }), testFilePath, 'build-1', null, makeOptions());
    const start = new Date(payload.start_time).getTime();
    const end = new Date(payload.end_time).getTime();
    expect(end - start).toBe(500);
  });
});

describe('mapToRelationPayload', () => {
  function makeTestPayload(overrides: Partial<ReturnType<typeof mapAssertionResult>> = {}) {
    return {
      uid: 'auth-login-001',
      name: 'Auth > user can log in',
      build: 'build-1',
      status: 'PASS' as const,
      start_time: '',
      end_time: '',
      is_rerun: false,
      info: {
        file: 'auth.test.ts',
        path: 'tests',
        tags: ['smoke'],
        duration: '1.0s',
      },
      ...overrides,
    };
  }

  test('sets uid, product, type', () => {
    const rel = mapToRelationPayload(makeTestPayload(), makeOptions());
    expect(rel.uid).toBe('auth-login-001');
    expect(rel.product).toBe('MyApp');
    expect(rel.type).toBe('Unit');
  });

  test('maps file, path, tags, components, teams from info', () => {
    const rel = mapToRelationPayload(
      makeTestPayload({
        info: { file: 'a.test.ts', path: 'tests', tags: ['smoke'], components: ['Auth'], teams: ['backend'], duration: '1s' },
      }),
      makeOptions(),
    );
    expect(rel.file).toBe('a.test.ts');
    expect(rel.path).toBe('tests');
    expect(rel.tags).toEqual(['smoke']);
    expect(rel.components).toEqual(['Auth']);
    expect(rel.teams).toEqual(['backend']);
  });

  test('puts non-reserved info keys into customs', () => {
    const rel = mapToRelationPayload(
      makeTestPayload({ info: { file: 'a.test.ts', path: 'tests', tags: [], duration: '1s', jira: 'PROJ-1', owner: 'alice' } }),
      makeOptions(),
    );
    expect(rel.customs).toEqual({ jira: 'PROJ-1', owner: 'alice' });
  });

  test('duration is not included in the relation', () => {
    const rel = mapToRelationPayload(makeTestPayload(), makeOptions());
    expect(rel.customs?.['duration']).toBeUndefined();
    expect((rel as unknown as Record<string, unknown>)['duration']).toBeUndefined();
  });

  test('omits empty tags/components/teams', () => {
    const rel = mapToRelationPayload(
      makeTestPayload({ info: { file: 'a.test.ts', path: 'tests', tags: [], duration: '1s' } }),
      makeOptions(),
    );
    expect(rel.tags).toBeUndefined();
    expect(rel.components).toBeUndefined();
    expect(rel.teams).toBeUndefined();
  });

  test('omits customs when no non-reserved keys exist', () => {
    const rel = mapToRelationPayload(makeTestPayload(), makeOptions());
    expect(rel.customs).toBeUndefined();
  });
});

describe('detectPlatformVersion', () => {
  test('returns a non-empty string', () => {
    expect(typeof detectPlatformVersion()).toBe('string');
    expect(detectPlatformVersion().length).toBeGreaterThan(0);
  });
});
