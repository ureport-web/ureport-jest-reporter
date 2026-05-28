import { basename, relative, dirname } from 'path';
import { release } from 'os';
import type { UReportTestPayload, UReportTestRelationPayload, UReportTestInfo, UReportStatus } from './types.js';
import type { UReportJestReporterOptions } from './config.js';

// Inline Jest types to avoid runtime dependency on @jest/test-result
export interface JestAssertionResult {
  fullName: string;
  title: string;
  ancestorTitles: string[];
  status: string;
  duration?: number | null;
  failureMessages: string[];
}

export function detectPlatformVersion(): string {
  return release();
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function mapStatus(status: string): UReportStatus {
  switch (status) {
    case 'passed':
      return 'PASS';
    case 'failed':
      return 'FAIL';
    default:
      // pending, skipped, todo, disabled
      return 'SKIP';
  }
}

/**
 * Maps a Jest AssertionResult to a UReport test payload.
 *
 * Timing: Jest gives duration but not absolute timestamps.
 * We set end_time = now and start_time = end_time - duration.
 */
export function mapAssertionResult(
  assertion: JestAssertionResult,
  testFilePath: string,
  buildId: string,
  meta: Record<string, unknown> | null,
  options: UReportJestReporterOptions,
): UReportTestPayload {
  const endTime = new Date();
  const durationMs = assertion.duration ?? 0;
  const startTime = new Date(endTime.getTime() - durationMs);

  const uid = (meta?.uid as string | undefined) ?? assertion.fullName;

  // Extract @word tags from test title
  const titleTags = (assertion.fullName.match(/@(\w+)/g) ?? []).map(t => t.slice(1));

  const info: UReportTestInfo = {
    file: basename(testFilePath),
    path: relative(process.cwd(), dirname(testFilePath)),
    duration: formatDuration(durationMs),
  };

  const quickInfoSet = new Set(options.quickInfoAnnotations ?? []);
  const RESERVED_META_KEYS = new Set(['uid', 'tags', 'components', 'teams', 'steps', 'setup', 'teardown']);

  if (meta) {
    const metaTags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    const allTags = [...new Set([...metaTags, ...titleTags])];
    if (allTags.length > 0) info.tags = allTags;

    if (Array.isArray(meta.components) && (meta.components as string[]).length > 0) {
      info.components = meta.components as string[];
    }
    if (Array.isArray(meta.teams) && (meta.teams as string[]).length > 0) {
      info.teams = meta.teams as string[];
    }
    // Custom fields → quickInfo or info as-is
    for (const [key, value] of Object.entries(meta)) {
      if (RESERVED_META_KEYS.has(key)) continue;
      if (quickInfoSet.has(key)) {
        const existing = (info['quickInfo'] as Array<{ key: string; value: string }> | undefined) ?? [];
        info['quickInfo'] = [...existing, { key, value: String(value) }];
      } else {
        info[key] = value;
      }
    }
  } else if (titleTags.length > 0) {
    info.tags = titleTags;
  }

  const payload: UReportTestPayload = {
    uid,
    name: assertion.fullName,
    build: buildId,
    status: mapStatus(assertion.status),
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    is_rerun: false,
    info,
  };

  if (Array.isArray(meta?.steps) && (meta!.steps as unknown[]).length > 0) payload.body = meta!.steps as import('./types.js').UReportStep[];
  if (Array.isArray(meta?.setup) && (meta!.setup as unknown[]).length > 0) payload.setup = meta!.setup as import('./types.js').UReportStep[];
  if (Array.isArray(meta?.teardown) && (meta!.teardown as unknown[]).length > 0) payload.teardown = meta!.teardown as import('./types.js').UReportStep[];

  if (assertion.status === 'failed' && assertion.failureMessages.length > 0) {
    payload.failure = {
      error_message: assertion.failureMessages[0] ?? '',
      stack_trace: assertion.failureMessages.join('\n'),
    };
  }

  return payload;
}

// Keys on info that map to dedicated relation fields or are non-customs — not put into customs.
const RELATION_INFO_KEYS = new Set(['file', 'path', 'tags', 'components', 'teams', 'duration', 'quickInfo']);

export function mapToRelationPayload(
  test: UReportTestPayload,
  options: UReportJestReporterOptions,
): UReportTestRelationPayload {
  const relation: UReportTestRelationPayload = {
    uid: test.uid,
    product: options.product,
    type: options.type,
  };

  const info = (test.info ?? {}) as UReportTestInfo;

  if (info.file) relation.file = info.file as string;
  if (info.path !== undefined) relation.path = info.path as string;
  if ((info.tags as string[] | undefined)?.length) relation.tags = info.tags as string[];
  if ((info.components as string[] | undefined)?.length) relation.components = info.components as string[];
  if ((info.teams as string[] | undefined)?.length) relation.teams = info.teams as string[];

  const customs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!RELATION_INFO_KEYS.has(key)) {
      customs[key] = value;
    }
  }
  if (Object.keys(customs).length > 0) relation.customs = customs;

  return relation;
}
