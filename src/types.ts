export interface UReportTestRelationPayload {
  uid: string;
  product: string;
  type: string;
  file?: string;
  path?: string;
  components?: string[];
  teams?: string[];
  tags?: string[];
  customs?: Record<string, unknown>;
}

export interface UReportBuildPayload {
  product: string;
  type: string;
  build: number;
  team?: string;
  browser?: string;
  device?: string;
  platform?: string;
  platform_version?: string;
  stage?: string;
  version?: string;
  start_time: string;
}

export interface UReportBuildResponse {
  _id: string;
  [key: string]: unknown;
}

export interface UReportFailure {
  error_message: string;
  stack_trace?: string;
}

export type UReportStatus = 'PASS' | 'FAIL' | 'SKIP';

export interface UReportTestInfo {
  file: string;
  path: string;
  tags?: string[];
  components?: string[];
  teams?: string[];
  duration?: string;
  [key: string]: unknown;
}

export interface UReportTestPayload {
  uid: string;
  name: string;
  build: string;
  status: UReportStatus;
  start_time: string;
  end_time: string;
  is_rerun: boolean;
  failure?: UReportFailure;
  info?: UReportTestInfo;
}
