import { IFileSystemConfig } from "@shared/interfaces";
import { Logger } from "@shared/utils";

let config: IFileSystemConfig|null;

export const getFileSystemConfig = (): IFileSystemConfig => {
  if (!config) {
    config = {
      paths: {
        test: "/tmp/test",
      },
    };

    Logger.log("[fileSystemConfig]", config.paths);
  }

  return config;
};
