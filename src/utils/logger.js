/**
 * Logger Utility — console + optional system log group sink
 * Never dumps stacks to user chats (that is handled by callers).
 */

import { LOG_LEVELS } from "../config/constants.js";

class Logger {
  constructor(level = LOG_LEVELS.WARN) {
    this.level = level;
    this.levels = {
      [LOG_LEVELS.SILENT]: 0,
      [LOG_LEVELS.ERROR]: 1,
      [LOG_LEVELS.WARN]: 2,
      [LOG_LEVELS.INFO]: 3,
      [LOG_LEVELS.DEBUG]: 4,
    };
    /** @type {null | ((level: string, msg: string, detail?: any) => Promise<void>)} */
    this.remoteSink = null;
  }

  setLevel(level) {
    this.level = level;
  }

  /**
   * Attach remote sink (system log group). Errors/warns forward there.
   */
  setRemoteSink(fn) {
    this.remoteSink = fn;
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    return [prefix, message, ...args];
  }

  async #remote(level, message, ...args) {
    if (!this.remoteSink) return;
    if (level !== "error" && level !== "warn") return;
    try {
      const detail = args.length ? args.map(String).join(" ") : undefined;
      await this.remoteSink(level, String(message), detail);
    } catch {
      /* never throw from logger */
    }
  }

  error(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.ERROR)) {
      console.error(...this.formatMessage("error", message, ...args));
      this.#remote("error", message, ...args);
    }
  }

  warn(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.WARN)) {
      console.warn(...this.formatMessage("warn", message, ...args));
      this.#remote("warn", message, ...args);
    }
  }

  info(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.INFO)) {
      console.log(...this.formatMessage("info", message, ...args));
    }
  }

  debug(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.DEBUG)) {
      console.log(...this.formatMessage("debug", message, ...args));
    }
  }

  success(message, ...args) {
    if (this.shouldLog(LOG_LEVELS.INFO)) {
      console.log("✅", message, ...args);
    }
  }

  command(commandName, user, group = null) {
    if (this.shouldLog(LOG_LEVELS.INFO)) {
      const location = group ? `in ${group}` : "in DM";
      this.info(`Command: ${commandName} by ${user} ${location}`);
    }
  }
}

const defaultLevel = process.env.LOG_LEVEL || LOG_LEVELS.WARN;
const logger = new Logger(defaultLevel);

export default logger;
export { Logger };
