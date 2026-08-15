import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  private level: LogLevel = "info";
  private file: string | null = null;

  init(): void {
    try {
      const dir = path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(dir, { recursive: true });
      this.file = path.join(dir, "nova.log");
      const header = `\n===== Nova Storage ${app.getVersion()} | ${new Date().toISOString()} =====\n`;
      fs.appendFileSync(this.file, header);
    } catch {
      this.file = null;
    }
  }

  private write(lvl: LogLevel, msg: string): void {
    if (LEVELS[lvl] < LEVELS[this.level]) return;
    const line = `[${new Date().toISOString()}] [${lvl.toUpperCase()}] ${msg}`;
    // eslint-disable-next-line no-console
    if (this.file) {
      try {
        fs.appendFileSync(this.file, line + "\n");
      } catch {
        /* noop */
      }
    }
    if (lvl === "error" || lvl === "warn") {
      // eslint-disable-next-line no-console
      console.error(line);
    }
  }

  debug(msg: string): void {
    this.write("debug", msg);
  }
  info(msg: string): void {
    this.write("info", msg);
  }
  warn(msg: string): void {
    this.write("warn", msg);
  }
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `\n${err.stack ?? err.message}` : "";
    this.write("error", msg + detail);
  }
}

export const logger = new Logger();
