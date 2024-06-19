import { pathExists, ensureDir, unlink } from "fs-extra";

import { getFileSystemConfig } from "@shared/configs";
import { Logger } from "@shared/utils";

import { ErrorHandler } from "./error-handler.service";

export class FileSystemService {
  private static logger = new Logger("FileSystemService");

  private static error = new ErrorHandler("FileSystemService");

  public static async safeUnlink(logPrefix: string, path: string): Promise<boolean> {
    try {
      if (await pathExists(path)) {
        this.logger.info(`${logPrefix} Deleting: ${path}`);
        await unlink(path);

        return true;
      }

      this.logger.warn(`${logPrefix} No file: ${path}`);

      return false;
    } catch (error) {
      return this.error.throw("safeUnlink", error, true, { path, logPrefix });
    }
  }

  public static async initializeFolders() {
    try {
      await ensureDir(getFileSystemConfig().paths.test);
      this.logger.info("[FileSystemService] Ensured the filesystem folder exist");
    } catch (error) {
      return this.error.throw("initializeFolders", error, true);
    }
  }
}
