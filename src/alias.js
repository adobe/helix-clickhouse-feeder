/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import aws4 from 'aws4';
import { Response } from '@adobe/fetch';
import { fetchContext } from './utils.js';

/**
 * Alias cache.
 */
export const ALIAS_CACHE = new Map();

/**
 * Fetch aliases from AWS.
 *
 * @param {UniversalContext} context universal context
 * @param {String} funcName function name
 * @param {String} funcVersion function version
 * @returns {Promise<Response>} HTTP answer
 * @throws {Promise<Error>} if AWS credentials are not available
 */
async function fetchAliases(context, funcName, funcVersion) {
  const { env } = context;

  const awsConfig = {
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  };

  if (!awsConfig.region || !awsConfig.accessKeyId || !awsConfig.secretAccessKey) {
    throw new Error('Missing AWS configuration (aws_region, aws_access_key_id or aws_secret_access_key)');
  }

  try {
    const { fetch } = fetchContext;
    const opts = {
      host: `lambda.${awsConfig.region}.amazonaws.com`,
      service: 'lambda',
      region: awsConfig.region,
      method: 'GET',
      path: `/2015-03-31/functions/${funcName}/aliases?FunctionVersion=${funcVersion}`,
    };
    const req = aws4.sign(opts, {
      accessKeyId: awsConfig.accessKeyId,
      secretAccessKey: awsConfig.secretAccessKey,
      sessionToken: awsConfig.sessionToken,
    });
    const resp = await fetch(`https://${req.host}${req.path}`, {
      method: req.method,
      headers: req.headers,
    });
    return resp;
  } catch (e) {
    return new Response(e.message, {
      status: 500,
      headers: {
        'content-type': 'text/plain',
        'cache-control': 'no-store, private, must-revalidate',
      },
    });
  }
}

/**
 * @typedef {Object} Alias
 * @property {string} major an alias starting `v`, e.g. `v1`
 * @property {string} full fully qualified alias, e.g. `1.2.3`
 */

/**
 * Clean an alias object of internal properties.
 *
 * @param {Alias} alias alias with internal properties
 * @returns {Alias} pure alias
 */
function cleanAlias(alias) {
  return ['major', 'full'].reduce((acc, key) => {
    if (alias[key]) {
      acc[key] = alias[key];
    }
    return acc;
  }, {});
}

/**
 * Resolve an alias for a function.
 *
 * @param {UniversalContext} context universal context
 * @param {String} funcName function name
 * @param {String} funcVersion function version
 * @returns {Promise<Alias|null>} alias
 */
export async function resolve(context, funcName, funcVersion) {
  const { log } = context;

  let alias = ALIAS_CACHE.get(funcName)?.[funcVersion];
  if (alias && alias.expiry > Date.now()) {
    return cleanAlias(alias);
  }
  log.debug(`Fetching aliases for: ${funcName}:${funcVersion}`);
  const resp = await fetchAliases(context, funcName, funcVersion);
  if (!resp.ok) {
    const msg = `Failed to retrieve aliases for ${funcName}: ${resp.status}\n${await resp.text()}`;
    log.warn(msg);
    return null;
  }
  const { Aliases: aliases } = await resp.json();
  if (aliases.length === 0) {
    const msg = `Failed to find any aliases for ${funcName} and version ${funcVersion}`;
    log.warn(msg);
    return null;
  }
  log.debug(`Found ${aliases.length} alias(es) for: ${funcName}:${funcVersion}`);

  alias = {};
  aliases.forEach(({ Name: name }) => {
    if (name.startsWith('v')) {
      alias.major = name;
    } else {
      alias.full = name.replace(/_/g, '.');
    }
  });
  alias.expiry = Date.now() + (!!alias.major && !!alias.full ? 60_000 : 2_000);

  const parent = ALIAS_CACHE.get(funcName) || {};
  parent[funcVersion] = alias;
  ALIAS_CACHE.set(funcName, parent);

  return cleanAlias(alias);
}
