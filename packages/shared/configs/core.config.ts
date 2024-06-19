import { ENVIRONMENT, ICoreConfig, APP_NAME } from "@shared/interfaces";
import { Logger, tryGetEnv } from "@shared/utils";

const getNodeEnvValue = (): ENVIRONMENT => {
  const stringValue = tryGetEnv("NODE_ENV", ENVIRONMENT.LOCAL);

  if (!Object.values(ENVIRONMENT).includes(stringValue as ENVIRONMENT)) {
    throw new Error(`[getNodeEnvValue] Invalid environment: ${stringValue}. Possible values: ${JSON.stringify(Object.values(ENVIRONMENT))}`);
  }

  return stringValue as ENVIRONMENT;
};

const getAppNameValue = (): APP_NAME => {
  const stringValue = tryGetEnv("APP_NAME");

  if (!Object.values(APP_NAME).includes(stringValue as APP_NAME)) {
    throw new Error(`[getAppNameValue] Invalid app name: ${stringValue}. Possible values: ${JSON.stringify(Object.values(APP_NAME))}`);
  }

  return stringValue as APP_NAME;
};

let config: ICoreConfig|null;

export const getCoreConfig = (): ICoreConfig => {
  if (!config) {
    config = {
      port: +tryGetEnv("PORT"),
      env: getNodeEnvValue(),
      appName: getAppNameValue(),
      allowedShutdownIp: tryGetEnv("ALLOWED_NODE_IP", "127.0.0.1"),
      serverUrl: tryGetEnv("SERVER_URL"),
    };

    Logger.log("[coreConfig]", {
      port: config.port,
      env: config.env,
      appName: config.appName,
      nodeJS: process.version,
      allowedShutdownIp: config.allowedShutdownIp,
      serverUrl: config.serverUrl,
    });
  }

  return config;
};
