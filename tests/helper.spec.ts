import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ureport } from '../src/helper';

// Capture real jest expect BEFORE any beforeEach can replace globalThis.expect
const jestExpect = expect;

// Mock fs to avoid writing actual temp files in unit tests
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const mockMkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

function makeExpectState(currentTestName: string, testPath: string) {
  return {
    getState: () => ({ currentTestName, testPath }),
  };
}

function computeKey(testPath: string, currentTestName: string): string {
  return crypto.createHash('md5').update(`${testPath}::${currentTestName}`).digest('hex');
}

describe('ureport helper', () => {
  const testFilePath = '/project/tests/auth.test.ts';
  const testName = 'Auth > user can log in';

  // Save the real jest expect so we can restore it after each test
  const realExpect = (globalThis as Record<string, unknown>)['expect'];

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up global expect mock so ureport() sees the test state
    (globalThis as Record<string, unknown>)['expect'] = makeExpectState(testName, testFilePath);
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>)['expect'] = realExpect;
  });

  test('calls mkdirSync to ensure the .ureport dir exists', () => {
    ureport({ uid: 'TC-001' });
    jestExpect(mockMkdirSync).toHaveBeenCalledWith(
      path.join(os.tmpdir(), '.ureport'),
      { recursive: true },
    );
  });

  test('writes JSON meta to the correct keyed file', () => {
    const meta = { uid: 'TC-001', components: ['Auth'], tags: ['smoke'] };
    ureport(meta);

    const expectedKey = computeKey(testFilePath, testName);
    const expectedPath = path.join(os.tmpdir(), '.ureport', `${expectedKey}.json`);
    jestExpect(mockWriteFileSync).toHaveBeenCalledWith(expectedPath, JSON.stringify(meta));
  });

  test('different test names produce different file keys', () => {
    (globalThis as Record<string, unknown>)['expect'] = makeExpectState('test A', testFilePath);
    ureport({ uid: 'TC-A' });
    const callA = (mockWriteFileSync as jest.Mock).mock.calls[0][0] as string;

    jest.clearAllMocks();
    (globalThis as Record<string, unknown>)['expect'] = makeExpectState('test B', testFilePath);
    ureport({ uid: 'TC-B' });
    const callB = (mockWriteFileSync as jest.Mock).mock.calls[0][0] as string;

    jestExpect(callA).not.toBe(callB);
  });

  test('different test paths produce different file keys', () => {
    (globalThis as Record<string, unknown>)['expect'] = makeExpectState(testName, '/project/tests/a.test.ts');
    ureport({ uid: 'TC-A' });
    const callA = (mockWriteFileSync as jest.Mock).mock.calls[0][0] as string;

    jest.clearAllMocks();
    (globalThis as Record<string, unknown>)['expect'] = makeExpectState(testName, '/project/tests/b.test.ts');
    ureport({ uid: 'TC-B' });
    const callB = (mockWriteFileSync as jest.Mock).mock.calls[0][0] as string;

    jestExpect(callA).not.toBe(callB);
  });

  test('works when globalThis.expect is unavailable (no crash)', () => {
    (globalThis as Record<string, unknown>)['expect'] = undefined;
    jestExpect(() => ureport({ uid: 'TC-001' })).not.toThrow();
    jestExpect(mockWriteFileSync).toHaveBeenCalled();
  });

  test('serializes custom fields into the JSON', () => {
    const meta = { uid: 'TC-001', jira: 'PROJ-42', owner: 'alice' };
    ureport(meta);
    const writtenContent = (mockWriteFileSync as jest.Mock).mock.calls[0][1] as string;
    jestExpect(JSON.parse(writtenContent)).toEqual(meta);
  });
});
