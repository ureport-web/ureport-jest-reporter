import * as fs from 'fs';
import { UReportJestReporter } from '../src/reporter';
import type { JestAssertionResult } from '../src/mapper';

// Mock fs and the api-client
jest.mock('fs');
jest.mock('../src/api-client', () => ({
  UReportApiClient: jest.fn().mockImplementation(() => ({
    createBuild: jest.fn().mockResolvedValue({ _id: 'build-abc' }),
    submitTests: jest.fn().mockResolvedValue(undefined),
    finalizeBuild: jest.fn().mockResolvedValue(undefined),
    saveTestRelation: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { UReportApiClient } = jest.requireMock('../src/api-client') as {
  UReportApiClient: jest.Mock;
};

const validOptions = {
  serverUrl: 'http://localhost:4100',
  apiToken: 'test-token',
  product: 'MyApp',
  type: 'Unit',
};

function makeTestResult(assertions: Partial<JestAssertionResult>[] = [{}]) {
  return {
    testFilePath: '/project/tests/auth.test.ts',
    testResults: assertions.map((a) => ({
      fullName: 'Auth > user can log in',
      title: 'user can log in',
      ancestorTitles: ['Auth'],
      status: 'passed',
      duration: 500,
      failureMessages: [],
      ...a,
    })),
  };
}

describe('UReportJestReporter', () => {
  let mockClient: {
    createBuild: jest.Mock;
    submitTests: jest.Mock;
    finalizeBuild: jest.Mock;
    saveTestRelation: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fs.readFileSync to return null (no metadata files)
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // Mock fs.unlinkSync
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});

    mockClient = {
      createBuild: jest.fn().mockResolvedValue({ _id: 'build-abc' }),
      submitTests: jest.fn().mockResolvedValue(undefined),
      finalizeBuild: jest.fn().mockResolvedValue(undefined),
      saveTestRelation: jest.fn().mockResolvedValue(undefined),
    };
    UReportApiClient.mockImplementation(() => mockClient);
  });

  test('onRunStart creates a build via the API client', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    expect(mockClient.createBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        product: 'MyApp',
        type: 'Unit',
      }),
    );
  });

  test('onRunStart stores buildId from API response', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    // Verify the reporter uses the buildId in subsequent calls
    reporter.onTestResult({} as never, makeTestResult() as never);
    await reporter.onRunComplete();
    expect(mockClient.submitTests).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ build: 'build-abc' })]),
    );
  });

  test('onRunStart stores lastError when validation fails', async () => {
    const reporter = new UReportJestReporter({}, { serverUrl: '', apiToken: '', product: '', type: '' });
    await reporter.onRunStart();
    expect(reporter.getLastError()).toBeInstanceOf(Error);
  });

  test('onTestResult collects assertion results', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    reporter.onTestResult({} as never, makeTestResult([{ status: 'passed' }, { status: 'failed', failureMessages: ['oops'] }]) as never);
    await reporter.onRunComplete();

    const submittedTests = mockClient.submitTests.mock.calls[0][0] as { status: string }[];
    expect(submittedTests).toHaveLength(2);
    expect(submittedTests[0].status).toBe('PASS');
    expect(submittedTests[1].status).toBe('FAIL');
  });

  test('onRunComplete finalizes the build', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    await reporter.onRunComplete();
    expect(mockClient.finalizeBuild).toHaveBeenCalledWith('build-abc');
  });

  test('onRunComplete submits tests in batches', async () => {
    const reporter = new UReportJestReporter({}, { ...validOptions, batchSize: 2 });
    await reporter.onRunStart();
    // 3 assertions → should result in 2 batch calls
    reporter.onTestResult({} as never, makeTestResult([{}, {}, {}]) as never);
    await reporter.onRunComplete();
    expect(mockClient.submitTests).toHaveBeenCalledTimes(2);
  });

  test('onRunComplete saves relations when saveRelations is true', async () => {
    const reporter = new UReportJestReporter({}, { ...validOptions, saveRelations: true });
    await reporter.onRunStart();
    reporter.onTestResult({} as never, makeTestResult() as never);
    await reporter.onRunComplete();
    expect(mockClient.saveTestRelation).toHaveBeenCalledTimes(1);
  });

  test('onRunComplete skips relations when saveRelations is false', async () => {
    const reporter = new UReportJestReporter({}, { ...validOptions, saveRelations: false });
    await reporter.onRunStart();
    reporter.onTestResult({} as never, makeTestResult() as never);
    await reporter.onRunComplete();
    expect(mockClient.saveTestRelation).not.toHaveBeenCalled();
  });

  test('onRunComplete deduplicates relations by uid', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    // Two assertions with the same fullName → same uid → only one relation
    reporter.onTestResult({} as never, makeTestResult([
      { fullName: 'Auth > login', status: 'passed' },
      { fullName: 'Auth > login', status: 'failed', failureMessages: ['retry'] },
    ]) as never);
    await reporter.onRunComplete();
    expect(mockClient.saveTestRelation).toHaveBeenCalledTimes(1);
  });

  test('onTestResult is a no-op when buildId is not set', () => {
    const reporter = new UReportJestReporter({}, validOptions);
    // onRunStart not called — buildId is empty
    reporter.onTestResult({} as never, makeTestResult() as never);
    // Should not throw, and onRunComplete should handle gracefully
    expect(mockClient.submitTests).not.toHaveBeenCalled();
  });

  test('getLastError returns undefined when no error occurred', async () => {
    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    await reporter.onRunComplete();
    expect(reporter.getLastError()).toBeUndefined();
  });

  test('onRunComplete writes outputFile when configured', async () => {
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    const reporter = new UReportJestReporter({}, { ...validOptions, outputFile: '/tmp/output.json' });
    await reporter.onRunStart();
    await reporter.onRunComplete();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/output.json',
      expect.any(String),
      'utf-8',
    );
  });

  test('reads meta from tmp file and uses uid from it', async () => {
    const meta = { uid: 'auth-login-001', components: ['Auth'] };
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(meta));
    (fs.unlinkSync as jest.Mock).mockImplementation(() => {});

    const reporter = new UReportJestReporter({}, validOptions);
    await reporter.onRunStart();
    reporter.onTestResult({} as never, makeTestResult([{ fullName: 'Auth > user can log in' }]) as never);
    await reporter.onRunComplete();

    const submittedTests = mockClient.submitTests.mock.calls[0][0] as { uid: string }[];
    expect(submittedTests[0].uid).toBe('auth-login-001');
  });
});
