import cluster from "cluster";
import { inspect } from "util";
import { isMainThread } from "worker_threads";

import { getCoreConfig } from "@shared/configs";

export type TLogLevel = "spam" | "debug" | "info" | "warn" | "error";

/**
 * Note: if you see issues with colors, consider using chalk instead of ANSI
 * since it has lots of workarounds for different environments
 */
enum EAnsiColor {
  RESET = "\x1b[0m",
  WHITE = "\x1b[37m",
  GREEN = "\x1b[32m",
  LIGHT_YELLOW = "\x1b[93m",
  RED = "\x1b[31m",
  LIGHT_BLUE = "\x1b[94m",
  GRAY = "\x1b[90m"
}

export const DEFAULT_LOGGER_LEVEL = "info";

export const INFO_LEVEL = 3;

export class Logger {
  private readonly colors: Map<TLogLevel, string> = new Map([
    ["spam", EAnsiColor.GRAY],
    ["debug", EAnsiColor.LIGHT_BLUE],
    ["info", EAnsiColor.WHITE],
    ["warn", EAnsiColor.LIGHT_YELLOW],
    ["error", EAnsiColor.RED],
  ]);

  private readonly levelOrder: Map<TLogLevel, number> = new Map([
    ["spam", 1],
    ["debug", 2],
    ["info", INFO_LEVEL],
    ["warn", 4],
    ["error", 5],
  ]);

  private prefix: string;

  constructor(prefix: string, private level: TLogLevel = DEFAULT_LOGGER_LEVEL) {
    this.prefix = `[${prefix}]`;
  }

  public updatePrefix(prefix: string) {
    this.prefix = prefix;
  }

  public spam(...messages: any[]) {
    // additional guard to prevent "spam" level logs on dev/production servers
    if (getCoreConfig().env !== "local") return;

    this.logMessage("spam", ...messages);
  }

  public debug(...messages: any[]) {
    // additional guard to prevent "debug" level logs on dev/production servers
    if (getCoreConfig().env !== "local") return;

    this.logMessage("debug", ...messages);
  }

  public info(...messages: any[]) {
    this.logMessage("info", ...messages);
  }

  public success(...messages: any[]) {
    const prefixedMessages = this.prefix ? [this.prefix, ...messages] : messages;

    Logger.printMessage(EAnsiColor.GREEN, ...prefixedMessages);
  }

  public warn(...messages: any[]) {
    this.logMessage("warn", ...messages);
  }

  public error(...messages: any[]) {
    this.logMessage("error", ...messages);
  }

  public debugOnlyError(...messages: any[]) {
    if (this.level !== "debug") return;

    this.logMessage("error", ...messages);
  }

  public static success(...messages: any[]) {
    Logger.printMessage(EAnsiColor.GREEN, ...messages);
  }

  public static log(...messages: any[]) {
    Logger.printMessage(EAnsiColor.WHITE, ...messages);
  }

  public static error(...messages: any[]) {
    Logger.printMessage(EAnsiColor.RED, ...messages);
  }

  public static warn(...messages: any[]) {
    Logger.printMessage(EAnsiColor.LIGHT_YELLOW, ...messages);
  }

  public static logObjectWithDepth(obj: any) {
    console.log(inspect(obj, true, null, true));
  }

  private logMessage(level: TLogLevel, ...messages: any[]) {
    if ((this.levelOrder.get(level) ?? INFO_LEVEL) < (this.levelOrder.get(this.level) ?? INFO_LEVEL)) return;

    const prefixedMessages = this.prefix ? [this.prefix, ...messages] : messages;

    const color = this.colors.get(level) ?? EAnsiColor.WHITE;

    Logger.printMessage(color, ...prefixedMessages);
  }

  private static printMessage(color: string, ...messages: any[]) {
    const workerPrefix = cluster?.worker?.id ? `[${cluster?.worker?.id}] ` : "";
    const threadWorkerPrefix = isMainThread ? "" : "[ThreadWorker] ";

    const timestamp = Logger.getTimestamp();
    const coloredMessages = messages.map((message) => (typeof message === "object" ? Logger.colorize(inspect(message, false, null), color) : Logger.colorize(message, color)));

    console.log(Logger.colorize(`${workerPrefix}${threadWorkerPrefix}[${timestamp}]`, color), ...coloredMessages);
  }

  private static getTimestamp(): string {
    return new Date().toISOString().split("T")[1].slice(0, -1);
  }

  private static colorize(text: string, color: string): string {
    return `${color}${text}${EAnsiColor.RESET}`;
  }
}
