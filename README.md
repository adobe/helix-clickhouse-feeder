# Helix ClickHouse Feeder

> Service that subscribes to CloudWatch logs for Helix services and pushes them to ClickHouse.

## Status
[![codecov](https://img.shields.io/codecov/c/github/adobe/helix-clickhouse-feeder.svg)](https://codecov.io/gh/adobe/helix-clickhouse-feeder)
[![GitHub license](https://img.shields.io/github/license/adobe/helix-clickhouse-feeder.svg)](https://github.com/adobe/helix-clickhouse-feeder/blob/main/LICENSE.txt)
[![GitHub issues](https://img.shields.io/github/issues/adobe/helix-clickhouse-feeder.svg)](https://github.com/adobe/helix-clickhouse-feeder/issues)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

## Installation

The AWS Console has an issue where a subscription filter can not be added with a specific version or alias, we therefore recommend to use the AWS CLI.

Given the service you want to push logs into ClickHouse for, e.g. `helix-services--my-service`, use the following command:

```
$ AWS_REGION=...; AWS_ACCOUNT_ID=...; aws logs put-subscription-filter \
  --log-group-name /aws/lambda/helix-services--my-service \
  --filter-name helix-clickhouse-feeder \
  --filter-pattern '[timestamp=*Z, request_id="*-*", event]' \
  --destination-arn "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--clickhouse-feeder:v1"
```

You can filter log events sent by level as follows:
```
  --filter-pattern '[timestamp=*Z, request_id="*-*", level=%WARN|ERROR%, event]'
```
this will invoke the feeder only for WARN and ERROR messages.

If you get an error that CloudWatch is not allowed to execute your function, add the following permission:
```
$ AWS_REGION=...; AWS_ACCOUNT_ID=...; aws lambda add-permission \
    --function-name "arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:helix3--clickhouse-feeder:v1" \
    --statement-id 'CloudWatchInvokeClickHouse' \
    --principal 'logs.amazonaws.com' \
    --action 'lambda:InvokeFunction' \
    --source-arn "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/lambda/*:*" \
    --source-account "${AWS_ACCOUNT_ID}"
```

The service uses the following environment variables:

| Name  | Description  | Required | Default |
|:------|:-------------|:---------|:--------|
| CLICKHOUSE_HOST | ClickHouse hostname | Yes | - |
| CLICKHOUSE_USER | ClickHouse user | Yes | - |
| CLICKHOUSE_PASSWORD | ClickHouse password | Yes | - |
| CLICKHOUSE_DATABASE | ClickHouse database name | No | helix_logs_production |
| CLICKHOUSE_LOG_LEVEL | Log level | No | info |


## Failure handling (async invocation)

The feeder Lambda is invoked asynchronously by a CloudWatch Logs subscription filter. Failed invocations are retried, then routed to an SQS queue so log batches aren't silently lost.

### Configuration

| Setting | Value |
|---|---|
| Invocation type | Asynchronous (CloudWatch Logs subscription filter) |
| On-failure destination | SQS: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:clickhouse-feeder-dlq` |
| Retry attempts | 2 (default) |
| Maximum event age | 6 hours (default) |
| Legacy DLQ setting | None (intentionally unused; the on-failure destination replaces it) |

### Setup steps

1. **Create the SQS queue** (e.g. `clickhouse-feeder-dlq`). Set message retention to 14 days (default is 4).
2. **Add the destination**: Lambda console > function > Configuration > Asynchronous invocation > Edit > Destinations > Add destination. Source: *Asynchronous invocation*, condition: *On failure*, target: the SQS queue.
3. **Check IAM**: the function's execution role needs `sqs:SendMessage` on the queue. If the queue uses a KMS key, the role also needs `kms:GenerateDataKey` and `kms:Decrypt`.
4. **Add CloudWatch alarms**:
   - Queue: `ApproximateNumberOfMessagesVisible` > 0
   - Function: `Errors` > 0 (catches failures before they reach the queue)
   - Function: `AsyncEventsDropped` > 0 (events that couldn't be delivered anywhere)
5. **Test it**: invoke the function asynchronously with a bad payload or force it to throw, then confirm a message lands in the queue after the retries (a few minutes):
   ```
   aws lambda invoke --function-name <FUNCTION_NAME> \
     --invocation-type Event --payload '{"bad":"payload"}' \
     --cli-binary-format raw-in-base64-out /dev/null
   ```

### Operating notes

- **Message contents**: each queue message holds the original payload plus error details (the request context and response). Use these to diagnose and replay.
- **Replay**: after fixing the cause, re-invoke the function with the original payload from each message, then delete the message. Document who owns this process.
- **Idempotency**: retries and replays can deliver the same log events more than once, so the downstream write must tolerate duplicates.
- **Payload limit**: async invocations are capped at 256 KB. Oversized batches fail before reaching the queue, so watch the `Errors` metric as well as queue depth.
- **Throttling**: throttled async events are retried for up to the max event age (6 hours), then dropped. Don't set reserved concurrency too low.

## Development

### Deploying Helix ClickHouse Feeder

All commits to main that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get committed as `helix3--clickhouse-feeder@ci<num>` and tagged with the CI build number.
