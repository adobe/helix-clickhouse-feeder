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
  DATADOG_API_KEY: 'api-key',
  DATADOG_LOG_LEVEL: 'info',
};

const DUAL_ENV = {
  ...DEFAULT_ENV,
  CLICKHOUSE_HOST: 'ch.example.cloud',
  CLICKHOUSE_USER: 'writer',
  CLICKHOUSE_PASSWORD: 'secret',
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
      fqn: 'arn:aws:lambda:us-east-1:123456789012:function:datadog-feeder:1_2_3',
      name: 'datadog-feeder',
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
    const payload = 'H4sIABDuMmkAA9WWTU8bMRCG7/yKKGc2mRl77HFuSAXUQ9sDnEoQctZOWCnZpLsboEL893pJwleLlCiiEnuyNR8ev/NovPcHnfR1Z7Gu/SSe/17E7qDT/XJ0fnT17fjs7Oj0uHu4cpnflrFqjYiiFRtDqN3GOJ1PTqv5ctHa+/627k/9bBR8/zpOi7usjtVNkcc6y4oyxLuU5jnsrKmin7VxBER9hD5x/8IYdSnWxrHRPgabazYgJmjwGKJBryXPN0nq5ajOq2LRFPPypJg2sapTuotH46PD+tDspWP30Xz5XMfxTSyb14H3T6tVmtBWqSwaEQVs0DKbJARqA1bIOiStEDWhQXEA4thoYeWSGTZKPWVriqR542etZGiMsSAA7ITe+K07sxEoQ8iIz1EPyAw091LAz2GD3mvnCLPcjSTTgHnmxspnYyInzo+EgYfN1+8nP4ZN8I0P88mgM54u6+uinHSws4hlaFdV/LVMVdW9Xm9Yvq043jWVz5sYToo4Da1UrwVaObUytsXud9hjrrXD1Ur4be74rywvhX5Xwu6ruIen3cPhtjQopcSJMCkLioGQWQugFWRHWpAUKbRW2ELabkWDAVa70GB6wLg3DfBXgzphXsYPA2Lr8/4fEysh92XCtN1WCjkNTGQhRieWjAGHWhw5q7mdEAma1GqNehsmMOWSHZhg7KWAxESw6GzMIUOPlJSyIROV64x9O6q851zDZ58Q29xxdxrWEu5Pg0s9VsaSEHB6FdKLZtEqdmiNKCHRWixoSE9fMr/F9h0aiHekgdjuTcNnmhAfxkQr5LtMrH4uDh7+APm1kT9eCQAA';

    nock('https://lambda.us-east-1.amazonaws.com')
      .get('/2015-03-31/functions/helix-services--indexer/aliases?FunctionVersion=663')
      .reply(200, {
        Aliases: [{
          Name: 'v4',
        }, {
          Name: '4_3_47',
        }],
      });

    nock.datadog({ apiKey: DEFAULT_ENV.DATADOG_API_KEY })
      .reply((_, body) => {
        assert.deepStrictEqual(body, [{
          ddsource: 'aws-lambda',
          ddtags: 'version:4.3.47',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:helix-services--indexer',
          message: JSON.stringify({
            inv: {
              invocationId: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
              functionName: '/helix-services/indexer/v4',
            },
            message: 'datadog: flushing 1 pending requests...',
            level: 'info',
            timestamp: '2022-10-25T14:26:45.982Z',
            logStream: '2022/10/25/[663]877ef64aed7c456086d40a1de61a48cc',
          }),
          timestamp: 1666708005982,
        }, {
          ddsource: 'aws-lambda',
          ddtags: 'version:4.3.47',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:helix-services--indexer',
          message: JSON.stringify({
            inv: {
              invocationId: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
              functionName: '/helix-services/indexer/v4',
            },
            message: 'datadog: flushing 0 pending requests done.',
            level: 'info',
            timestamp: '2022-10-25T14:26:46.051Z',
            logStream: '2022/10/25/[663]877ef64aed7c456086d40a1de61a48cc',
          }),
          timestamp: 1666708006053,
        }, {
          ddsource: 'aws-lambda',
          ddtags: 'version:4.3.47',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:helix-services--indexer',
          message: JSON.stringify({
            inv: {
              invocationId: 'd7197ec0-1a12-407d-83c4-5a8900aa5c40',
              functionName: '/helix-services/indexer/v4',
            },
            message: 'datadog: flushing 1 pending requests...',
            level: 'info',
            timestamp: '2022-10-25T14:26:51.188Z',
            logStream: '2022/10/25/[663]877ef64aed7c456086d40a1de61a48cc',
          }),
          timestamp: 1666708011188,
        }, {
          ddsource: 'aws-lambda',
          ddtags: 'version:4.3.47',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:helix-services--indexer',
          message: JSON.stringify({
            inv: {
              invocationId: 'd7197ec0-1a12-407d-83c4-5a8900aa5c40',
              functionName: '/helix-services/indexer/v4',
            },
            message: 'datadog: flushing 0 pending requests done.',
            level: 'info',
            timestamp: '2022-10-25T14:26:51.257Z',
            logStream: '2022/10/25/[663]877ef64aed7c456086d40a1de61a48cc',
          }),
          timestamp: 1666708011258,
        }]);
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

    nock.datadog()
      .reply((_, body) => {
        assert.deepStrictEqual(body, [{
          ddsource: 'aws-lambda',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:services--func',
          message: JSON.stringify({
            inv: {
              invocationId: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
              functionName: '/services/func/$LATEST',
            },
            message: 'this\nis\na\nmessage',
            level: 'info',
            timestamp: '2022-10-25T14:26:45.982Z',
            logStream: '2022/10/28/[$LATEST]dbbf94bd5cb34f00aa764103d8ed78f2',
          }),
          timestamp: 1666708005982,
        }]);
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

    nock.datadog({ url: 'https://www.example.com' })
      .reply((_, body) => {
        assert.deepStrictEqual(body, [{
          ddsource: 'aws-lambda',
          ddtags: 'version:4.3.47',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:services--func',
          message: JSON.stringify({
            inv: {
              invocationId: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
              functionName: '/services/func/4.3.47',
            },
            message: 'this\nis\na\nmessage',
            level: 'info',
            timestamp: '2022-10-25T14:26:45.982Z',
            logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
          }),
          timestamp: 1666708005982,
        }]);
        return [200];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload, {
          ...DEFAULT_ENV,
          DATADOG_API_URL: 'https://www.example.com',
        }),
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

    nock.datadog({ url: 'https://www.example.com' })
      .reply((_, body) => {
        assert.deepStrictEqual(body, [{
          ddsource: 'aws-lambda',
          hostname: 'lambda',
          level: 'INFO',
          service: 'arn:aws:lambda:us-east-1:123456789012:function:services--func',
          message: JSON.stringify({
            inv: {
              invocationId: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
              functionName: '/services/func/356',
            },
            message: 'this\nis\na\nmessage',
            level: 'info',
            timestamp: '2022-10-25T14:26:45.982Z',
            logStream: '2022/10/28/[356]dbbf94bd5cb34f00aa764103d8ed78f2',
          }),
          timestamp: 1666708005982,
        }]);
        return [200];
      });

    await assert.doesNotReject(
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload, {
          ...DEFAULT_ENV,
          DATADOG_API_URL: 'https://www.example.com',
        }),
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

  it('returns error when DATADOG_API_KEY is missing', async () => {
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
    delete env.DATADOG_API_KEY;

    const res = await main(new Request('https://localhost/'), TEST_CONTEXT(payload, env));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(await res.text(), 'No DATADOG_API_KEY set');
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

    nock.datadog()
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

  it('allows definining subscription filter without pattern', async () => {
    const contents = await fs.readFile(resolve(__rootdir, 'test', 'fixtures', 'patternless.json'));
    const { input, output } = JSON.parse(contents);

    nock.datadog()
      .reply((_, body) => {
        assert.deepStrictEqual(body, output);
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
          DATADOG_LOG_LEVEL: 'debug',
        }),
      ),
    );
  });

  it('sends to both DataDog and ClickHouse when both configured', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\thello dual\n',
            request_id: '1aa49921-c9b8-401c-9f3a-f22989ab8505',
            timestamp: '2022-10-25T14:26:45.982Z',
          },
          timestamp: 1666708005982,
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[$LATEST]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock.datadog()
      .reply(200);

    nock.clickhouse()
      .reply((_, body) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const lines = raw.trim().split('\n');
        assert.strictEqual(lines.length, 1);
        const entry = JSON.parse(lines[0]);
        assert.strictEqual(entry.function_name, '/services/func/$LATEST');
        assert.strictEqual(entry.message, 'hello dual');
        return [200];
      });

    const res = await main(
      new Request('https://localhost/'),
      TEST_CONTEXT(payload, DUAL_ENV),
    );
    assert.strictEqual(res.status, 202);
  });

  it('ClickHouse failure does NOT throw when DataDog succeeds', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tmessage\n',
          },
          timestamp: Date.now(),
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[$LATEST]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock.datadog()
      .reply(200);

    nock.clickhouse()
      .twice()
      .replyWithError('clickhouse down');

    const res = await main(
      new Request('https://localhost/'),
      TEST_CONTEXT(payload, DUAL_ENV),
    );
    assert.strictEqual(res.status, 202);
  });

  it('DataDog failure throws even when ClickHouse succeeds', async () => {
    const payload = (await gzip(JSON.stringify({
      logEvents: [
        {
          extractedFields: {
            event: 'INFO\tmessage\n',
          },
          timestamp: Date.now(),
        },
      ],
      logGroup: '/aws/lambda/services--func',
      logStream: '2022/10/28/[$LATEST]dbbf94bd5cb34f00aa764103d8ed78f2',
    }))).toString('base64');

    nock.datadog()
      .reply(403, 'forbidden');

    nock.clickhouse()
      .reply(200);

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
      async () => main(
        new Request('https://localhost/'),
        TEST_CONTEXT(payload, DUAL_ENV),
      ),
      /forbidden/,
    );
  });
});
