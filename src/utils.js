/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import {
  context, ALPN_HTTP1_1, FetchError, timeoutSignal,
} from '@adobe/fetch';
import wrapFetch from 'fetch-retry';

/**
 * Our global fetch context that limits the number of sockets used.
 */
export const fetchContext = context({
  maxCacheSize: 0,
  alpnProtocols: [ALPN_HTTP1_1],
  h1: { keepAlive: false, maxSockets: 4 },
});

const { reset, fetch } = fetchContext;

export const resetConnections = async () => reset();

const MOCHA_ENV = (process.env.HELIX_FETCH_FORCE_HTTP1 === 'true');
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const isTimeout = (e) => e?.name === 'AbortError' || e?.name === 'TimeoutError';

/**
 * Create a fetch wrapper that retries on FetchError and throws on bad status.
 *
 * @param {string} label label used in error messages (e.g. "ClickHouse")
 * @param {number} [timeout] request timeout in milliseconds
 * @returns {typeof fetch} wrapped fetch function
 */
export function createFetchRetry(label, timeout) {
  const fetchWithTimeout = async (input, init = {}) => {
    const signal = timeout ? timeoutSignal(timeout) : undefined;

    try {
      const res = await fetch(input, {
        ...init,
        ...(signal ? { signal } : {}),
      });
      return res;
    } finally {
      signal?.clear();
    }
  };

  return wrapFetch(fetchWithTimeout, {
    retryDelay: (attempt) => (MOCHA_ENV ? 1 /* c8 ignore next */ : 2 ** attempt * 1000),
    retryOn: async (attempt, error, response) => {
      const retries = MOCHA_ENV ? 1 /* c8 ignore next */ : 2;
      if (error) {
        if ((error instanceof FetchError || isTimeout(error)) && attempt < retries) {
          return true;
        }
        throw error;
      }
      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          await response.text(); // drain before retrying
          return true;
        }
        throw new Error(`Failed to send logs to ${label} with status ${response.status}: ${await response.text()}`);
      }
      return false;
    },
  });
}
