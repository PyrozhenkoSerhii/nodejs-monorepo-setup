import { IStorageConfig } from "@shared/interfaces";
import { Logger, tryGetEnv } from "@shared/utils";

let config: IStorageConfig|null;

export const getStorageConfig = (): IStorageConfig => {
  if (!config) {
    const bucket = tryGetEnv("STORAGE_BUCKET_NAME");

    config = {
      endpoint: tryGetEnv("STORAGE_ENDPOINT"),
      region: tryGetEnv("STORAGE_REGION"),
      key: tryGetEnv("STORAGE_KEY"),
      secret: tryGetEnv("STORAGE_SECRET"),
      bucket,
      maxAttempts: 3, // maximum number of times a request can be retried if it fails
      delayBeforeDelete: 10000,
      uploadConfigs: {
        public: {
          mp4: {
            Bucket: bucket,
            ACL: "public-read",
            ContentType: "video/mp4",
          },
          text: {
            Bucket: bucket,
            ContentType: "text/plain",
            ACL: "public-read",
          },
        },
      },
      prefixes: {
        base: "adwave",
        logs: "logs",
        health: "health",
      },
    };

    Logger.log("[storageConfig]", {
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      uploadConfigs: config.uploadConfigs,
      prefixes: config.prefixes,
    });
  }

  return config;
};
