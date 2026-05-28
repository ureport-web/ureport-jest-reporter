import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { UReportStep } from './types.js';

export interface UReportMeta {
  uid?: string;
  components?: string[];
  teams?: string[];
  tags?: string[];
  steps?: UReportStep[];
  setup?: UReportStep[];
  teardown?: UReportStep[];
  [key: string]: unknown;
}

/**
 * Annotates the current Jest test with UReport metadata (uid, components, teams, tags, custom fields).
 *
 * Call this inside a test body. Uses Jest's `expect.getState()` to identify the current test,
 * then writes metadata to a temp file for the reporter to pick up in `onTestResult`.
 *
 * @example
 * test('user can log in', () => {
 *   ureport({ uid: 'auth-login-001', components: ['Auth'], tags: ['smoke'] });
 *   // ... test assertions
 * });
 */
export function ureport(meta: UReportMeta): void {
  // Jest injects `expect` into the global scope in test environments.
  // We access it via globalThis to avoid a hard dependency on @jest/globals.
  const jestExpect = (globalThis as Record<string, unknown>)['expect'] as
    | { getState(): { currentTestName?: string; testPath?: string } }
    | undefined;

  const state = jestExpect?.getState() ?? {};
  const currentTestName: string = state.currentTestName ?? '';
  const testPath: string = state.testPath ?? '';

  const key = crypto.createHash('md5').update(`${testPath}::${currentTestName}`).digest('hex');
  const dir = path.join(os.tmpdir(), '.ureport');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(meta));
}
