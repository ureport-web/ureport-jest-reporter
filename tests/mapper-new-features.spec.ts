import { mapAssertionResult, mapToRelationPayload } from '../src/mapper';
import type { JestAssertionResult } from '../src/mapper';
import type { UReportJestReporterOptions } from '../src/config';

function makeAssertion(overrides: Partial<JestAssertionResult> = {}): JestAssertionResult {
  return {
    fullName: 'Auth > user can log in',
    title: 'user can log in',
    ancestorTitles: ['Auth'],
    status: 'passed',
    duration: 100,
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

const FILE = '/project/tests/auth.test.ts';

describe('title tag extraction', () => {
  test('extracts @word tags from fullName when no meta', () => {
    const assertion = makeAssertion({ fullName: 'login flow @smoke @regression' });
    const payload = mapAssertionResult(assertion, FILE, 'build-1', null, makeOptions());
    expect(payload.info?.tags).toEqual(['smoke', 'regression']);
  });

  test('merges title tags with meta.tags and deduplicates', () => {
    const assertion = makeAssertion({ fullName: 'login @smoke' });
    const payload = mapAssertionResult(assertion, FILE, 'build-1', { tags: ['smoke', 'p1'] }, makeOptions());
    expect(payload.info?.tags).toEqual(['smoke', 'p1']);
  });

  test('title tags only when meta has no tags', () => {
    const assertion = makeAssertion({ fullName: 'login @fast' });
    const payload = mapAssertionResult(assertion, FILE, 'build-1', { uid: 'TC-1' }, makeOptions());
    expect(payload.info?.tags).toEqual(['fast']);
  });

  test('no title tags and no meta → info.tags undefined', () => {
    const assertion = makeAssertion({ fullName: 'simple test' });
    const payload = mapAssertionResult(assertion, FILE, 'build-1', null, makeOptions());
    expect(payload.info?.tags).toBeUndefined();
  });

  test('title tag relation has tag in relation.tags', () => {
    const assertion = makeAssertion({ fullName: 'flow @smoke' });
    const payload = mapAssertionResult(assertion, FILE, 'build-1', null, makeOptions());
    const rel = mapToRelationPayload(payload, makeOptions());
    expect(rel.tags).toContain('smoke');
  });
});

describe('quickInfo annotations', () => {
  test('quickInfoAnnotations keys go to info.quickInfo array', () => {
    const options = makeOptions({ quickInfoAnnotations: ['env', 'build_url'] });
    const payload = mapAssertionResult(makeAssertion(), FILE, 'build-1',
      { env: 'staging', build_url: 'https://ci/1' }, options);
    const qi = payload.info?.['quickInfo'] as Array<{ key: string; value: string }>;
    expect(qi).toContainEqual({ key: 'env', value: 'staging' });
    expect(qi).toContainEqual({ key: 'build_url', value: 'https://ci/1' });
  });

  test('quickInfo keys not stored as scalar info fields', () => {
    const options = makeOptions({ quickInfoAnnotations: ['env'] });
    const payload = mapAssertionResult(makeAssertion(), FILE, 'build-1', { env: 'prod' }, options);
    expect(payload.info?.['env']).toBeUndefined();
  });

  test('non-quickInfo custom keys still go to scalar info', () => {
    const options = makeOptions({ quickInfoAnnotations: ['env'] });
    const payload = mapAssertionResult(makeAssertion(), FILE, 'build-1',
      { env: 'prod', jira: 'PROJ-1' }, options);
    expect(payload.info?.['jira']).toBe('PROJ-1');
  });

  test('quickInfo keys not in relation customs', () => {
    const options = makeOptions({ quickInfoAnnotations: ['env'] });
    const payload = mapAssertionResult(makeAssertion(), FILE, 'build-1', { env: 'prod' }, options);
    const rel = mapToRelationPayload(payload, options);
    expect(rel.customs?.['env']).toBeUndefined();
    expect(rel.customs?.['quickInfo']).toBeUndefined();
  });
});
