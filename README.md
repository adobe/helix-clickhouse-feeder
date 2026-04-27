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
    --source-arn "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/lambda/helix-services--my-service:*" \
    --source-account "${AWS_ACCOUNT_ID}"
```
If there are multiple services you want to add this subscription filter to, it is easier to replace the source arn
with a more generic expression:
```
    --source-arn "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/lambda/*:*"
```

The service uses the following environment variables:

| Name  | Description  | Required | Default |
|:------|:-------------|:---------|:--------|
| CLICKHOUSE_HOST | ClickHouse hostname | Yes | - |
| CLICKHOUSE_USER | ClickHouse user | Yes | - |
| CLICKHOUSE_PASSWORD | ClickHouse password | Yes | - |
| CLICKHOUSE_DATABASE | ClickHouse database name | No | helix_logs_production |
| CLICKHOUSE_LOG_LEVEL | Log level | No | info |

If delivery to ClickHouse fails, the service will send the unprocessed messages to the AWS SQS queue named `helix-clickhouse-feeder-dlq`.

## Development

### Deploying Helix ClickHouse Feeder

All commits to main that pass the testing will be deployed automatically. All commits to branches that will pass the testing will get committed as `helix3--clickhouse-feeder@ci<num>` and tagged with the CI build number.
