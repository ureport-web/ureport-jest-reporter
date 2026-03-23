import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { validateOptions } from './config.js';
import type { UReportJestReporterOptions } from './config.js';
import { UReportApiClient } from './api-client.js';
import { mapAssertionResult, mapToRelationPayload, detectPlatformVersion } from './mapper.js';
import type { JestAssertionResult } from './mapper.js';
import type { UReportTestPayload, UReportBuildPayload, UReportTestRelationPayload } from './types.js';

interface JestTestResult {
  testFilePath: string;
  testResults: JestAssertionResult[];
}

interface JestTest {
  path: string;
}

export class UReportJestReporter {
  private options!: UReportJestReporterOptions;
  private client!: UReportApiClient;
  private buildId = '';
  private buildPayload!: UReportBuildPayload;
  private collectedTests: UReportTestPayload[] = [];
  private collectedRelations: UReportTestRelationPayload[] = [];
  private lastError: Error | undefined;

  constructor(
    _globalConfig: unknown,
    private readonly rawOptions: Partial<UReportJestReporterOptions> = {},
  ) {}

  async onRunStart(): Promise<void> {
    try {
      this.options = validateOptions(this.rawOptions);
      this.client = new UReportApiClient(this.options.serverUrl, this.options.apiToken);

      if (this.options.autoDetectPlatform !== false) {
        if (!this.options.platform) this.options.platform = process.platform;
        if (!this.options.platform_version) this.options.platform_version = detectPlatformVersion();
      }

      const rawBuild = this.options.buildNumber;
      const buildNumber =
        typeof rawBuild === 'number' ? rawBuild : parseInt(String(rawBuild), 10) || Date.now();

      this.buildPayload = {
        product: this.options.product,
        type: this.options.type,
        build: buildNumber,
        team: this.options.team,
        browser: this.options.browser,
        device: this.options.device,
        platform: this.options.platform,
        platform_version: this.options.platform_version,
        stage: this.options.stage,
        version: this.options.version,
        start_time: new Date().toISOString(),
      };

      const build = await this.client.createBuild(this.buildPayload);
      this.buildId = build._id;
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  onTestResult(_test: JestTest, testResult: JestTestResult): void {
    if (!this.buildId) return;

    for (const assertion of testResult.testResults) {
      const meta = this.readMeta(testResult.testFilePath, assertion.fullName);
      const payload = mapAssertionResult(
        assertion,
        testResult.testFilePath,
        this.buildId,
        meta,
        this.options,
      );
      this.collectedTests.push(payload);
    }
  }

  async onRunComplete(): Promise<void> {
    if (!this.buildId) return;

    try {
      const { batchSize = 50 } = this.options;

      for (let i = 0; i < this.collectedTests.length; i += batchSize) {
        const batch = this.collectedTests.slice(i, i + batchSize);
        await this.client.submitTests(batch);
      }

      await this.client.finalizeBuild(this.buildId);

      if (this.options.saveRelations !== false) {
        const seen = new Set<string>();
        for (const test of this.collectedTests) {
          if (seen.has(test.uid)) continue;
          seen.add(test.uid);
          const relation = mapToRelationPayload(test, this.options);
          this.collectedRelations.push(relation);
          await this.client.saveTestRelation(relation);
        }
      }

      const pass = this.collectedTests.filter((t) => t.status === 'PASS').length;
      const fail = this.collectedTests.filter((t) => t.status === 'FAIL').length;
      const skip = this.collectedTests.filter((t) => t.status === 'SKIP').length;

      console.log(
        `[ureport-jest-reporter] Build ${this.buildId} finalized — PASS: ${pass}, FAIL: ${fail}, SKIP: ${skip}`,
      );

      if (this.options.outputFile) {
        const output = JSON.stringify(
          { build: this.buildPayload, tests: this.collectedTests, relations: this.collectedRelations },
          null,
          2,
        );
        fs.writeFileSync(this.options.outputFile, output, 'utf-8');
        console.log(`[ureport-jest-reporter] Payload saved to ${this.options.outputFile}`);
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  getLastError(): Error | void {
    return this.lastError;
  }

  private readMeta(testFilePath: string, fullName: string): Record<string, unknown> | null {
    const key = crypto
      .createHash('md5')
      .update(`${testFilePath}::${fullName}`)
      .digest('hex');
    const filePath = path.join(os.tmpdir(), '.ureport', `${key}.json`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      fs.unlinkSync(filePath);
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
