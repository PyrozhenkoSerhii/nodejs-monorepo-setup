export enum LOCATOR_SERVICE_EVENT {
  HEALTH_CHANGE = "HEALTH_CHANGE",
}

export enum LOCATOR_SERVICE_NAME {
  RABBIT_MQ = "RabbitMqService",
  S3 = "S3",
  REDIS = "redis",
}

export enum LOCATOR_SERVICE_HEALTH {
  NOT_INITIALIZED = "NOT_INITIALIZED", // default state
  GOOD = "GOOD", // everything is connected and working
  BAD = "BAD", // lost the connection, trying to reconnect
  CRITICAL = "CRITICAL", // gave up on reconnection, need to gracefully shutdown everything
  STOPPED = "STOPPED", // manually stopped the service
}

export interface ILocatorService {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: LOCATOR_SERVICE_EVENT.HEALTH_CHANGE, listener: (health: LOCATOR_SERVICE_HEALTH) => void): this;
}
