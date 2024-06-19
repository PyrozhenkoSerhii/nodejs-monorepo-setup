export enum ENVIRONMENT {
  LOCAL = "local",
  DEV = "dev",
}

export enum APP_NAME {
  RENDERER = "renderer",
}

export interface ICoreConfig {
  port: number;
  env: ENVIRONMENT;
  appName: string;
  allowedShutdownIp: string;
  serverUrl: string;
}
