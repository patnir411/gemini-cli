/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import winston from 'winston';

export function createLogger(label: string): winston.Logger {
  return winston.createLogger({
    level: process.env['LOG_LEVEL'] ?? 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.label({label}),
      winston.format.printf(({timestamp, label: l, level, message, ...meta}) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${l}] ${level}: ${message}${metaStr}`;
      })
    ),
    transports: [new winston.transports.Console()],
  });
}
