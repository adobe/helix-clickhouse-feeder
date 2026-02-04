/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable no-await-in-loop */

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Request } from '@adobe/fetch';
import { extractFields } from './extract-fields.js';
import { createFetchRetry } from './utils.js';

const gzipAsync = promisify(gzip);

/**
 * @typedef LogEvent
 * @property {string} id event id
 * @property {number} timestamp timestamp
 * @property {string} message message, which might have a variety of formats
 * @property {string} extractedFields extracted fields,
 * only present when a non-empty filter pattern has been specified
 */

/**
 * @typedef DataDogLogEntry
 * @property {number} timestamp timestamp
 * @property {string} message JSON stringified object, containing various fields
 * @property {string} level log level
 */

const LOG_LEVELS = [
  'TRACE', 'SILLY', 'DEBUG', 'VERBOSE', 'INFO', 'WARN', 'ERROR',
];

const fetchRetry = createFetchRetry('DataDog');

/**
 * DataDog logger.
 */
export class DataDogLogger {
  /**
   * Creates an instance of DataDogLogger.
   *
   * @param {Object} opts options for configuring the DataDogLogger
   * @param {string} opts.apiKey API key
   * @param {string} opts.funcName lambda function name, e.g. `/services/func/v1`
   * @param {string} opts.service service arn
   * @param {string} [opts.version] function version, e.g. `1.2.3`
   * @param {string} [opts.logStream] log stream name
   * @param {Console} [opts.log=console] logger object; defaults to console
   * @param {string} [opts.apiUrl='https://http-intake.logs.datadoghq.com'] dataDog API endpoint URL
   * @param {string} [opts.level='info'] log level threshold
   */
  constructor(opts) {
    const {
      apiKey,
      funcName,
      service,
      version,
      logStream,
      log = console,
      apiUrl = 'https://http-intake.logs.datadoghq.com',
      level = 'info',
    } = opts;

    this._apiKey = apiKey;
    this._functionName = funcName;
    this._logStream = logStream;
    this._log = log;
    this._apiUrl = apiUrl;

    const minLevel = LOG_LEVELS.indexOf(level.toUpperCase());
    this._minLevel = minLevel !== -1 ? minLevel : LOG_LEVELS.indexOf('INFO');

    this._baseEntry = {
      service,
      ddsource: 'aws-lambda',
      hostname: 'lambda',
    };
    if (version) {
      this._baseEntry.ddtags = `version:${version}`;
    }
  }

  /**
   * Check if log level should be sent based on configured minimum level
   *
   * @param {string} level log level to check
   * @returns {boolean} whether to send this log level
   */
  shouldSendLevel(level) {
    return LOG_LEVELS.indexOf(level) >= this._minLevel;
  }

  /**
   * Send payload to DataDog.
   *
   * @param {DataDogLogEntry[]} payload payload
   * @returns {Promise<Response>} HTTP answer
   * @throws {Promise<Error>} if an error occurs
   */
  async sendPayload(payload) {
    const url = `${this._apiUrl}/api/v2/logs`;
    const body = await gzipAsync(JSON.stringify(payload));
    const resp = await fetchRetry(new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'DD-API-KEY': this._apiKey,
      },
      body,
    }));
    return resp;
  }

  /**
   * Create a log entry for DataDog from a log event. Returns `null` if we cannot
   * make up individual fields in the log event.
   *
   * @param {LogEvent} logEvent log event
   * @returns {DataDogLogEntry|null} transformed log entry
   */
  createLogEntry(logEvent) {
    const { timestamp } = logEvent;
    const { log } = this;

    const fields = extractFields(logEvent);
    if (!fields) {
      log.warn(`Unable to extract fields from: ${JSON.stringify(logEvent, 0, 2)}`);
      return null;
    }
    const { message, requestId } = fields;
    const level = LOG_LEVELS.indexOf(fields.level) !== -1 ? fields.level : 'INFO';

    const text = {
      inv: {
        invocationId: requestId || 'n/a',
        functionName: this._functionName,
      },
      message: message.trimEnd(),
      level: fields.level.toLowerCase(),
      timestamp: fields.timestamp,
    };
    if (this._logStream) {
      text.logStream = this._logStream;
    }
    return {
      timestamp,
      message: JSON.stringify(text),
      level,
    };
  }

  /**
   * Send entries to DataDog
   *
   * @param {LogEvent[]} logEvents log events
   * @returns {Promise<{rejected: LogEvent[], sent: number}>}
   * result with rejected entries and count sent
   */
  async sendEntries(logEvents) {
    const rejected = [];
    const logEntries = [];

    for (const logEvent of logEvents) {
      const logEntry = this.createLogEntry(logEvent);
      if (!logEntry) {
        rejected.push(logEvent);
      } else if (this.shouldSendLevel(logEntry.level.toUpperCase())) {
        logEntries.push(logEntry);
      }
    }
    if (logEntries.length) {
      await this.sendPayload(logEntries.map((logEntry) => ({
        ...logEntry,
        ...this._baseEntry,
      })));
    }
    return { rejected, sent: logEntries.length };
  }

  get log() {
    return this._log;
  }
}
