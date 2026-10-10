import { maskSecrets, redactValue } from './redact.ts';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function thresholdLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;

  return configured !== undefined && configured in LEVELS ? (configured as LogLevel) : 'info';
}

function createLogger(bindings: LogFields): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVELS[level] < LEVELS[thresholdLevel()]) {
      return;
    }

    const record = {
      level,
      time: new Date().toISOString(),
      message: maskSecrets(message),
      ...(redactValue({ ...bindings, ...fields }) as LogFields),
    };

    const line = JSON.stringify(record);

    if (LEVELS[level] >= LEVELS.warn) {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = createLogger({});
