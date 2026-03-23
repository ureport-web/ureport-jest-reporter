export interface UReportJestReporterOptions {
  // Required
  serverUrl: string;
  apiToken: string;
  product: string;
  type: string;
  // Optional build metadata
  buildNumber?: string | number;
  team?: string;
  browser?: string;
  device?: string;
  platform?: string;
  platform_version?: string;
  stage?: string;
  version?: string;
  // Behavior
  batchSize?: number;
  saveRelations?: boolean;
  autoDetectPlatform?: boolean;
  outputFile?: string;
  quickInfoAnnotations?: string[];
}

export const DEFAULT_OPTIONS = {
  batchSize: 50,
  saveRelations: true,
  autoDetectPlatform: true,
} as const;

const REQUIRED_FIELDS: (keyof UReportJestReporterOptions)[] = [
  'serverUrl',
  'apiToken',
  'product',
  'type',
];

export function validateOptions(options: Partial<UReportJestReporterOptions>): UReportJestReporterOptions {
  for (const field of REQUIRED_FIELDS) {
    if (!options[field]) {
      throw new Error(`[ureport-jest-reporter] Missing required option: "${field}"`);
    }
  }

  return {
    ...DEFAULT_OPTIONS,
    ...options,
    buildNumber: options.buildNumber ?? Date.now(),
  } as UReportJestReporterOptions;
}
