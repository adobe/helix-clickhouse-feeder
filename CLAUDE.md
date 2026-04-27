# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS Lambda service that subscribes to CloudWatch log streams from Helix services and forwards them to ClickHouse. Failed deliveries are sent to an SQS Dead Letter Queue. Deployed via `@adobe/helix-deploy` (hedy) to AWS Lambda (Node 22).

## Commands

| Task | Command |
|------|---------|
| Run all tests | `npm test` |
| Run a single test | `npx mocha test/<file>.test.js` |
| Run post-deploy tests | `npm run test-postdeploy` |
| Lint | `npm run lint` |
| Local dev server | `npm start` |
| Build | `npm run build` |

Code coverage is enforced at **100%** for lines, branches, and statements (configured in `.nycrc.json`).

## Architecture

ES modules (`"type": "module"`). The main handler (`src/index.js`) is wrapped with `@adobe/helix-shared-wrap` and `@adobe/helix-shared-secrets` middleware.

**Request flow:**
1. `index.js` — Receives CloudWatch log event, decompresses gzip payload, resolves the Lambda alias, then sends to ClickHouse. Failure throws (triggers DLQ).
2. `clickhouse.js` — `ClickHouseLogger` sends logs to ClickHouse via HTTP with JSONEachRow format, async insert, and log-level filtering.
3. `extract-fields.js` — Parses AWS Lambda log lines with a chain of regex extractors (`MESSAGE_EXTRACTORS`). Returns `{level, message, requestId?, timestamp?}`.
4. `alias.js` — Resolves Lambda function version to alias name via AWS Lambda API. Results are cached in-memory (60s complete, 2s partial).
5. `dlq.js` — Sends failed payloads to SQS (`helix-<funcName>-dlq`) using AWS Signature v4.
6. `utils.js` — Shared `@adobe/fetch` context with socket pooling (512 max) and retry wrapper via `fetch-retry`.
7. `constants.js` — Log level severity mapping used for filtering.

## Testing

- Framework: Mocha + Node `assert`
- HTTP mocking: nock, with helpers in `test/utils.js` (`nock.clickhouse()`, `nock.done()`)
- `test/setup-env.js` forces HTTP/1.1 (ALPN protocol override)
- Mocha config is in `package.json` under `"mocha"` key (requires `mocha-suppress-logs`)

## CI/CD

GitHub Actions (`.github/workflows/main.yaml`): test on all pushes, CI deploy on branches, semantic-release on main. Releases auto-deploy and run post-deploy tests.
