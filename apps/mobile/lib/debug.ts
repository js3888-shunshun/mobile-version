/**
 * Simple debug logger for mobile app.
 *
 * - In __DEV__ mode, logs are enabled by default.
 * - Set EXPO_PUBLIC_DEBUG=false in .env to disable.
 * - Or call setDebugEnabled(false) at runtime.
 *
 * All logs are prefixed with [MobileApp] for easy filtering.
 */

const DEBUG_ENV = process.env.EXPO_PUBLIC_DEBUG;
let enabled = __DEV__ && DEBUG_ENV !== "false";

export function setDebugEnabled(value: boolean) {
  enabled = value;
}

export function isDebugEnabled() {
  return enabled;
}

type LogLevel = "log" | "warn" | "error" | "info";

function formatMessage(tag: string, message: string, data?: unknown): string {
  const parts = [`[MobileApp]`, `[${tag}]`, message];
  if (data !== undefined) {
    parts.push(JSON.stringify(data, null, 0));
  }
  return parts.join(" ");
}

function logAtLevel(level: LogLevel, tag: string, message: string, data?: unknown) {
  if (!enabled) return;
  const formatted = formatMessage(tag, message, data);
  const fn = console[level] as (...args: unknown[]) => void;
  fn(formatted);
}

export const debug = {
  /** General info */
  log(tag: string, message: string, data?: unknown) {
    logAtLevel("log", tag, message, data);
  },
  /** Warning — something unexpected but non-fatal */
  warn(tag: string, message: string, data?: unknown) {
    logAtLevel("warn", tag, message, data);
  },
  /** Error — something failed */
  error(tag: string, message: string, data?: unknown) {
    logAtLevel("error", tag, message, data);
  },
  /** Startup/shutdown events */
  info(tag: string, message: string, data?: unknown) {
    logAtLevel("info", tag, message, data);
  },
};
