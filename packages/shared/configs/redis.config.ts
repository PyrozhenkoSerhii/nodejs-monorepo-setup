import { IRedisConfig } from "@shared/interfaces";
import { Logger, tryGetEnv } from "@shared/utils";

let config: IRedisConfig|null;

export const getRedisConfig = (): IRedisConfig => {
  if (!config) {
    config = {
      host: tryGetEnv("REDIS_HOST", "redis-sentinel"),
      username: "default",
      port: +tryGetEnv("REDIS_PORT", "26379"),
      password: tryGetEnv("REDIS_PASSWORD"),
      tls: process.env.NODE_ENV === "local" ? undefined : {},
      masterName: tryGetEnv("REDIS_MASTER_NAME", "mymaster"),
      database: +tryGetEnv("REDIS_DATABASE", "0"),
      delayBeforeDelete: +tryGetEnv("REDIS_DELETE_DELAY", "30000"),
      expiration: {
        amqpMessages: 1000 * 60 * 60 * 24, // 1 day
      },
    };

    Logger.log("[redisConfig]", {
      host: config.host,
      port: config.port,
      tls: config.tls,
      database: config.database,
      masterName: config.masterName,
      delayBeforeDelete: config.delayBeforeDelete,
      expiration: config.expiration,
    });
  }

  return config;
};
