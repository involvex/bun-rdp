export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel) {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(currentLevel);
}

export const log = {
  debug: (tag: string, ...args: unknown[]) => shouldLog('debug') && console.debug(`[${tag}]`, ...args),
  info:  (tag: string, ...args: unknown[]) => shouldLog('info')  && console.info (`[${tag}]`, ...args),
  warn:  (tag: string, ...args: unknown[]) => shouldLog('warn')  && console.warn (`[${tag}]`, ...args),
  error: (tag: string, ...args: unknown[]) => shouldLog('error') && console.error(`[${tag}]`, ...args),
};

export function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}
