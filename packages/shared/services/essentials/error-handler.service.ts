import { Logger } from "@shared/utils";

interface CustomError {
  processed: boolean;
  info: ErrorInfo;
}

interface ErrorInfo {
  error: any; // full error
  codePath: string; // string project path
  extra?: object; // any additional data
}

export class ErrorHandler {
  private readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  /**
   * Method calls throw
   *
   * method - method name, which got an error;
   * error - error Object (or some custom value);
   * shouldLog - if we want to log to console;
   * extra - any additional data
   */
  public throw(
    method: string,
    error: any,
    shouldLog?: boolean,
    extra?: object,
  ): never {
    const processedError = this.getProcessedError(method, error, extra);

    if (shouldLog) {
      Logger.error(
        processedError.codePath,
        extra ?? "",
        processedError.error?.message,
        processedError.error?.body ?? "",
      );
    }

    if (!error?.processed) {
      const newError = { info: processedError, processed: true };

      throw newError;
    } else {
      throw error;
    }
  }

  /**
   * Method returns custom error string
   *
   * method - method name, which got an error;
   * error - error Object (or some custom value);
   * shouldLog - if we want to log to console;
   * extra - any additional data
   */
  public get(
    method: string,
    error: any,
    shouldLog?: boolean,
    extra?: object,
  ): CustomError {
    const processedError = this.getProcessedError(method, error, extra);

    if (shouldLog) {
      Logger.error(processedError.codePath, extra, processedError.error?.message, processedError.error?.body);
    }

    if (!error?.processed) {
      const newError = { info: processedError, processed: true };

      return newError;
    }

    return error;
  }

  private getProcessedError(
    method: string,
    error: any,
    extra?: object,
  ): ErrorInfo {
    return {
      codePath: `[Service:${this.serviceName}][Method:${method}()]`,
      extra,
      error,
    };
  }
}
