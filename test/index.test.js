/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import assert from 'assert';
import { resolve } from 'path';
import fs from 'fs/promises';
import util from 'util';
import zlib from 'zlib';
import { Request } from '@adobe/fetch';
import { ALIAS_CACHE } from '../src/alias.js';
import { main } from '../src/index.js';
import { Nock } from './utils.js';

const gzip = util.promisify(zlib.gzip);

const DEFAULT_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'aws-access-key-id',
  AWS_SECRET_ACCESS_KEY: 'aws-secret-access-key',
  AWS_SESSION_TOKEN: 'aws-session-token',
  CLICKHOUSE_HOST: 'ch.example.cloud',
  CLICKHOUSE_USER: 'writer',
  CLICKHOUSE_PASSWORD: 'secret',
  CLICKHOUSE_LOG_LEVEL: 'info',
};

describe('Index Tests', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock();
    ALIAS_CACHE.clear();
  });

  afterEach(() => {
    nock.done();
  });

  const TEST_CONTEXT = (data, env = DEFAULT_ENV) => ({
    invocation: {
      event: {
        awslogs: {
          data,
        },
      },
    },
    runtime: {
      region: 'us-east-1',
      accountId: 'account-id',
    },
    func: {
      app: 'aws-account-id',
      fqn: 'arn:aws:lambda:us-east-1:123456789012:function:clickhouse-feeder:1_2_3',
      name: 'clickhouse-feeder',
    },
    env,
    log: console,
  });

  it('invokes index without payload', async () => {
    await assert.doesNotReject(
      async () => main(new Request('https://localhost/'), TEST_CONTEXT()),
    );
  });

  it('invokes index with payload', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tdatadog: flushing 1 pending requests...\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:45.982Z',
          },
          timestamp: 1666708005982,
        },
        {
          extractedFields: {
            event: 'INFO\tdatadog: flushing 0 pending requests done.\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:46.051Z',
          },
          timestamp: 1666708006053,
        },
      ],
      logGroup: '/aws/lambda/helix-services--indexer',
      logStream: '2022/10/25/[663]877ef64aed7c456086d40a1de61a48cc',
    }))).toString('base64');

    nock('https://lambda.us-east-1.amazonaws.com')
      .get('/2015-03-31/functions/helix-services--indexer/aliases?FunctionVersion=663')
      .reply(200, {
        Aliases: [{
          Name: 'v4',
        }, {
          Name: '4_3_47',
        }],
      });

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        assert.strictEqual(lines.length, 2);
        const entry0 = JSON.parse(lines[0]);
        assert.strictEqual(entry0.function_name, '/helix-services/indexer/v4');
        assert.strictEqual(entry0.message, 'datadog: flushing 1 pending requests...');
        assert.strictEqual(entry0.request_id, '1aa49921-c9b8-401c-9f3a-f22989ab8505');
        assert.strictEqual(entry0.level, 'info');
        assert.strictEqual(entry0.timestamp, 1666708005982);
        const entry1 = JSON.parse(lines[1]);
        assert.strictEqual(entry1.function_name, '/helix-services/indexer/v4');
        assert.strictEqual(entry1.message, 'datadog: flushing 0 pending requests done.');
        return [200];
      });

    await assert.doesNotReject(
      async () => main(new Request('https://localhost/'), TEST_CONTEXT(payload)),
    );
  });

  it('allows calling $LATEST version of a function', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tthis\nis\na\nmessage\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:45.982Z',
          },
          timestamp: 1666708005982,
        },
        {
          extractedFields: {
            event: 'DEBUG\tlirum\nlarum\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8506',
            timestamp: '2022-10-25T14:26:45.983Z',
          },
          timestamp: 1666708005983,
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[$LATEST]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        // only INFO entry should be sent (DEBUG filtered at default info level)
        assert.strictEqual(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.strictEqual(entry.function_name, '/services/func/$LATEST');
        assert.strictEqual(entry.message, 'this\nis\na\nmessage');
        return [200];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload, DEFAULT_ENV),
      ),
    );
  });

  it('defaults to full version if major alias is not available', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tthis\nis\na\nmessage\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:45.982Z',
          },
          timestamp: 1666708005982,
        },
        {
          extractedFields: {
            event: 'DEBUG\tlirum\nlarum\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8506',
            timestamp: '2022-10-25T14:26:45.983Z',
          },
          timestamp: 1666708005983,
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock('https://lambda.us-east-1.amazonaws.com')
      .get('/2015-03-31/functions/services--func/aliases?FunctionVersion=356')
      .reply(200, {
        Aliases: [{
          Name: '4_3_47',
        }],
      });

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        assert.strictEqual(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.strictEqual(entry.function_name, '/services/func/4.3.47');
        return [200];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload),
      ),
    );
  });

  it('defaults to function version if no alias is available', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tthis\nis\na\nmessage\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:45.982Z',
          },
          timestamp: 1666708005982,
        },
        {
          extractedFields: {
            event: 'DEBUG\tlirum\nlarum\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8506',
            timestamp: '2022-10-25T14:26:45.983Z',
          },
          timestamp: 1666708005983,
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock('https://lambda.us-east-1.amazonaws.com')
      .get('/2015-03-31/functions/services--func/aliases?FunctionVersion=356')
      .reply(200, {
        Aliases: [],
      });

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        assert.strictEqual(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.strictEqual(entry.function_name, '/services/func/356');
        return [200];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload),
      ),
    );
  });

  it('returns error when uncompressing fails', async () => {
    const payload = 'this is not compressed'.toString('base64');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, `<?xml version="1.0"?>
<SendMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <SendMessageResult>
    <MessageId>id</MessageId>
  </SendMessageResult>
  <ResponseMetadata>
    <RequestId>id</RequestId>
  </ResponseMetadata>
</SendMessageResponse>
`);
    await assert.rejects(
      async () => main(new Request('https://localhost/'), TEST_CONTEXT(payload)),
      /incorrect header check/,
    );
  });

  it('returns error when ClickHouse configuration is missing', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [{
        timestamp: Date.now(),
        extractedFields: {
          event: 'INFO\tmessage\n',
        },
      }],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    const env = { ...DEFAULT_ENV };
    delete env.CLICKHOUSE_HOST;

    const res = await main(new Request('https://localhost/'), TEST_CONTEXT(payload, env));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(await res.text(), 'Missing ClickHouse configuration (CLICKHOUSE_HOST, CLICKHOUSE_USER, or CLICKHOUSE_PASSWORD)');
  });

  it('returns error when AWS environment is missing', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [{
        timestamp: Date.now(),
        extractedFields: {
          event: 'INFO\tmessage\n',
        },
      }],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    const env = { ...DEFAULT_ENV };
    delete env.AWS_SECRET_ACCESS_KEY;

    await assert.rejects(
      async () => main(new Request('https://localhost/'), TEST_CONTEXT(payload, env)),
      /Missing AWS configuration/,
    );
  });

  it('returns error when posting fails', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [{
        timestamp: Date.now(),
        extractedFields: {
          event: 'INFO\tmessage\n',
        },
      }],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock('https://lambda.us-east-1.amazonaws.com')
      .get('/2015-03-31/functions/services--func/aliases?FunctionVersion=356')
      .reply(200, {
        Aliases: [{
          Name: 'v4',
        }, {
          Name: '4_3_47',
        }],
      });

    nock.clickhouse()
      .reply(403, 'that went wrong');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, `<?xml version="1.0"?>
<SendMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <SendMessageResult>
    <MessageId>id</MessageId>
  </SendMessageResult>
  <ResponseMetadata>
    <RequestId>id</RequestId>
  </ResponseMetadata>
</SendMessageResponse>
`);
    await assert.rejects(
      async () => main(new Request('https://localhost/'), TEST_CONTEXT(payload)),
      /that went wrong/,
    );
  });

  it('allows defining subscription filter without pattern', async () => {
    const contents = await fs.readFile(resolve(__rootdir, 'test', 'fixtures', 'patternless.json'));
    const { input, expectedCount } = JSON.parse(contents);

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        assert.strictEqual(lines.length, expectedCount);
        return [200];
      });
    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply((_, body) => {
        const rejected = JSON.parse(new URLSearchParams(body).get('MessageBody'));
        assert.strictEqual(rejected.length, 1);
        assert.deepStrictEqual(rejected[0].message, 'This message has no known pattern and will be discarded\n');
        return [200, `<?xml version="1.0"?>
<SendMessageResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/">
  <SendMessageResult>
    <MessageId>id</MessageId>
  </SendMessageResult>
  <ResponseMetadata>
    <RequestId>id</RequestId>
  </ResponseMetadata>
</SendMessageResponse>
`];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/', {
          method: 'POST',
          body: JSON.stringify(input),
          headers: { 'content-type': 'application/json' },
        }),
        TEST_CONTEXT(null, {
          ...DEFAULT_ENV,
          CLICKHOUSE_LOG_LEVEL: 'debug',
        }),
      ),
    );
  });
});
