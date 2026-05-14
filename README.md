# ureport-jest-reporter

A Jest reporter that automatically ships test results to [UReport](https://github.com/your-org/ureport).

## Install

```bash
npm install -D ureport-jest-reporter
```

## Configuration

### Minimal config

```js
// jest.config.js
module.exports = {
  reporters: [
    "default",
    [
      "ureport-jest-reporter",
      {
        serverUrl: process.env.UREPORT_URL,    // e.g. "http://localhost:4100"
        apiToken: process.env.UREPORT_API_TOKEN, // API token from UReport user settings
        product: "MyApp",
        type: "Unit",
      },
    ],
  ],
};
```

> **Getting your API token:** In UReport, go to **User Settings → API Token** and generate a token. Store it as an environment variable — never commit it to source control.

### Full config (all options)

```js
// jest.config.js
module.exports = {
  reporters: [
    "default",
    [
      "ureport-jest-reporter",
      {
        // --- required ---
        serverUrl: process.env.UREPORT_URL,
        apiToken: process.env.UREPORT_API_TOKEN,
        product: "MyApp",
        type: "Unit",           // 'Unit' | 'Integration' | any string

        // --- build metadata ---
        buildNumber: process.env.BUILD_NUMBER, // defaults to Date.now()
        team: "Backend Team",
        platform: "linux",      // overrides auto-detection
        platform_version: "22.04",
        stage: "staging",
        version: "1.4.2",       // app version under test

        // --- payload control ---
        batchSize: 50,          // test results per POST (default: 50)
        saveRelations: true,    // save test relations after build (default: true)
        autoDetectPlatform: true, // auto-detect OS platform/version (default: true)
        outputFile: "./ureport-output.json", // optional: save payload for inspection
      },
    ],
  ],
};
```

### All options

| Option               | Type               | Required | Default       | Description                                                                    |
| -------------------- | ------------------ | -------- | ------------- | ------------------------------------------------------------------------------ |
| `serverUrl`          | `string`           | Yes      | —             | UReport server base URL                                                        |
| `apiToken`           | `string`           | Yes      | —             | API token from UReport user settings                                           |
| `product`            | `string`           | Yes      | —             | Product name in UReport                                                        |
| `type`               | `string`           | Yes      | —             | Build type, e.g. `"Unit"`, `"Integration"`                                     |
| `buildNumber`        | `string \| number` | No       | `Date.now()`  | CI build number                                                                |
| `team`               | `string`           | No       | —             | Team name                                                                      |
| `browser`            | `string`           | No       | —             | Browser name, if applicable                                                    |
| `device`             | `string`           | No       | —             | Device name, if applicable                                                     |
| `platform`           | `string`           | No       | auto-detected | OS platform                                                                    |
| `platform_version`   | `string`           | No       | auto-detected | OS version string (from `os.release()`)                                        |
| `stage`              | `string`           | No       | —             | Deployment stage, e.g. `"staging"`, `"prod"`                                   |
| `version`            | `string`           | No       | —             | Application version under test                                                 |
| `batchSize`          | `number`           | No       | `50`          | Number of test results per POST request                                        |
| `saveRelations`      | `boolean`          | No       | `true`        | Save test relation records (uid, components, teams, tags) after the build      |
| `autoDetectPlatform` | `boolean`          | No       | `true`        | Set to `false` to disable auto-detection of `platform` and `platform_version`  |
| `outputFile`         | `string`           | No       | —             | Write the full submitted payload to this JSON file after the run               |
| `quickInfoAnnotations` | `string[]`       | No       | `[]`          | No effect in the current version — reserved for future use                     |

---

## Annotating tests

Use the `ureport()` helper to attach metadata to a test. Call it anywhere inside the test body — it reads the current test name automatically via Jest's `expect.getState()` and communicates with the reporter via a temp file (no custom `testEnvironment` required).

```ts
import { ureport } from "ureport-jest-reporter";
```

### Stable UID (recommended)

```ts
test("user can log in", () => {
  ureport({ uid: "auth-login-001" });
  // ... test assertions
});
```

> Always set a `uid`. Without it, the reporter falls back to the full test name — which breaks historical tracking if you ever rename the test.

### Components, teams, and tags

```ts
test("checkout flow", () => {
  ureport({
    uid: "checkout-flow-001",
    components: ["Checkout", "Cart"],
    teams: ["Frontend"],
    tags: ["smoke", "regression"],
  });
  // ... test assertions
});
```

### Custom metadata

Any field beyond `uid`, `components`, `teams`, and `tags` is stored as freeform metadata on the test relation — useful for linking to issue trackers or tracking ownership:

```ts
test("password reset", () => {
  ureport({
    uid: "auth-reset-001",
    components: ["Auth"],
    jira: "AUTH-42",
    owner: "alice",
  });
  // ... test assertions
});
```

### describe blocks

`ureport()` works correctly inside `describe` blocks. Jest's `expect.getState().currentTestName` returns the full name (e.g. `Auth > user can log in`), which is what the reporter uses as the fallback `uid` and the test `name`.

```ts
describe("Auth", () => {
  test("user can log in", () => {
    ureport({ uid: "auth-login-001", components: ["Auth"] });
    expect(true).toBe(true);
  });

  test("user can log out", () => {
    ureport({ uid: "auth-logout-001", components: ["Auth"] });
    expect(true).toBe(true);
  });
});
```

---

## Relations

Relations link each test to a stable identity in UReport (uid, components, teams, tags, custom fields). The reporter saves one relation per unique uid after the build finalizes — no setup needed beyond using `ureport()`.

What gets saved per relation:

| Field | Source |
|---|---|
| `uid` | `ureport({ uid })` or full test name fallback |
| `product` / `type` | reporter options |
| `file` / `path` | test file location (relative to cwd) |
| `tags` | `ureport({ tags })` |
| `components` | `ureport({ components })` |
| `teams` | `ureport({ teams })` |
| `customs` | any extra keys in `ureport({})` (e.g. `jira`, `owner`) |

Relations are deduplicated by uid — one per test per run. Disable with `saveRelations: false`.

> **Note:** Jest has no native tag-from-title extraction (`@smoke` in test names is NOT auto-extracted). Use `ureport({ tags: ['smoke'] })` explicitly.

---

## How it works

Jest runs tests in worker processes; the reporter runs in the main process. The `ureport()` helper bridges them via temp files:

1. Inside a test, `ureport({ uid, components, ... })` is called
2. The helper reads `expect.getState().currentTestName` and `expect.getState().testPath` to derive a unique key (MD5 hash of `testPath::testName`)
3. Metadata is written to `os.tmpdir()/.ureport/<hash>.json`
4. In `onTestResult`, the reporter reconstructs the same key from `testFilePath + assertionResult.fullName`, reads the file, and deletes it

Reporter lifecycle:

| Hook              | Action                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `onRunStart`      | Validates options, auto-detects platform, creates a build record via the API    |
| `onTestResult`    | Reads metadata temp files, maps each `AssertionResult` to a UReport payload     |
| `onRunComplete`   | Batch-submits tests, finalizes the build, optionally saves test relations        |
| `getLastError`    | Returns any stored error so Jest can surface it                                  |

Status mapping:

| Jest status | UReport status |
| ----------- | -------------- |
| `passed`    | `PASS`         |
| `failed`    | `FAIL`         |
| `pending`   | `SKIP`         |
| `skipped`   | `SKIP`         |
| `todo`      | `SKIP`         |

> Jest's `--testRetryCount` retries don't distinguish rerun vs. original attempt at the reporter level, so `is_rerun` is always `false`.

---

## Development

### Setup

```bash
npm install
npm run build     # compile CJS + ESM + types to dist/
```

### Running tests

```bash
npm test
```

### Smoke test against a real server

```js
// jest.smoke.config.js
module.exports = {
  testMatch: ["**/smoke/**/*.test.ts"],
  reporters: [
    "default",
    [
      "./dist/cjs/index.js",
      {
        serverUrl: process.env.UREPORT_URL,
        apiToken: process.env.UREPORT_API_TOKEN,
        product: "SmokeTest",
        type: "Unit",
        buildNumber: Date.now(),
      },
    ],
  ],
};
```

```bash
npm run build
UREPORT_URL=http://your-ureport-server \
UREPORT_API_TOKEN=your-token \
npx jest --config jest.smoke.config.js
```

```bash
npm pack   # inspect the tarball before publishing
```
