import EventEmitter from "events";

import { ChainableCommander, Redis } from "ioredis";
import Redlock from "redlock";

import { getCoreConfig, getRedisConfig } from "@shared/configs";
import { ERedisStatusEvent } from "@shared/constants";
import { ILocatorService, LOCATOR_SERVICE_EVENT, LOCATOR_SERVICE_HEALTH, LOCATOR_SERVICE_NAME } from "@shared/interfaces";
import { PrometheusService, ErrorHandler } from "@shared/services";
import { Logger } from "@shared/utils";

export type CallbackFn = (message: string, channel: string) => void;

export type UnsubscribeFn = () => Promise<void>;

export enum ERedisKey {
  FALLEN_JOB = "fallen_job",
}

export enum ERedisChannel {
  TEST = "test",
}

export enum ERedisOperationType {
  GET = "get",
  SET = "set",
  DELETE = "delete",
  SET_EXP = "set_exp",
  GET_PATTERN = "get_pattern",
  MGET = "mget",
  PUBLISH = "publish",
}

export interface IRedisClientService {
  redlock: Redlock;
  get(key: string, baseKey: ERedisKey, shouldParse?: boolean): Promise<any | null>;
  incr(key: string, baseKey: ERedisKey): Promise<number | undefined>;
  pipeline(): ChainableCommander | undefined;
  mget(keys: string[], baseKey: ERedisKey): Promise<(string | null)[]>;
  set(key: string, value: any, baseKey: ERedisKey, shouldStringify?: boolean): Promise<void>;
  delete(key: string, baseKey: ERedisKey): Promise<void>;
  setExpiration(key: string, timeoutSeconds: number, baseKey: ERedisKey): Promise<boolean>;
  getKeysByPatternEfficient(keyPattern: string, baseKey: ERedisKey): Promise<string[]>;
  publish(channel: string, value: any, baseKey: ERedisKey, shouldStringify?: boolean): Promise<void>;
  subscribe(channel: string, listener: CallbackFn): Promise<UnsubscribeFn>;
  subscribeToEvents(): Promise<void>;
  unsubscribeFromEvents(): Promise<void>;
}

const MAX_CONNECTION_ATTEMPTS = 3; // for first start

export class RedisService extends EventEmitter implements ILocatorService {
  private redisConfig = getRedisConfig();

  private client: Redis | null = null;

  public redlock: Redlock | null = null;

  private eventSubscription?: Redis;

  private error = new ErrorHandler("RedisService");

  private logger = new Logger("RedisService", "debug");

  private health = LOCATOR_SERVICE_HEALTH.NOT_INITIALIZED;

  private unsubscribeFns: UnsubscribeFn[] = [];

  private attemptsCounter = 0;

  private firstConnection = true;

  constructor() {
    super();
  }

  async connect(): Promise<void> {
    this.logger.info("Trying to connect");

    this.initInstances();
    try {
      await this.setupListeners();
    } catch (error) {
      this.handleThrowError("Failed to setup listeners", error);
    }
  }

  public getPublicInstance = () => {
    if (!this.redlock) this.handleThrowError("Redlock not found");

    return {
      redlock: this.redlock,
      get: this.get.bind(this),
      incr: this.incr.bind(this),
      pipeline: this.pipeline.bind(this),
      mget: this.mget.bind(this),
      set: this.set.bind(this),
      delete: this.delete.bind(this),
      setExpiration: this.setExpiration.bind(this),
      getKeysByPatternEfficient: this.getKeysByPatternEfficient.bind(this),
      publish: this.publish.bind(this),
      subscribe: this.subscribe.bind(this),
      subscribeToEvents: this.subscribeToEvents.bind(this),
      unsubscribeFromEvents: this.unsubscribeFromEvents.bind(this),
    };
  };

  private initInstances() {
    this.client = new Redis({
      host: this.redisConfig.host,
      port: this.redisConfig.port,
      password: this.redisConfig.password,
      sentinelPassword: this.redisConfig.password,
      name: this.redisConfig.masterName,
      db: this.redisConfig.database,
      tls: this.redisConfig.tls,
    });

    this.redlock = new Redlock([this.client], {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    });
  }

  private setupListeners(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.REDIS);
        PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.NO_CLIENT, 1, LOCATOR_SERVICE_NAME.REDIS);

        return reject(this.handleThrowError("[setupListeners] Redis client not found"));
      }

      this.client.on("reconnecting", () => {
        this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
        PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.RECONNECTING, 1, LOCATOR_SERVICE_NAME.REDIS);
      });
      // On the event of an error, the "error" and "reconnecting" are triggered cyclically, so we use a check in this place
      this.client.on("error", (err) => {
        this.logger.warn("Reconnection attempt", err);
        if (this.firstConnection && this.attemptsCounter++ === MAX_CONNECTION_ATTEMPTS) {
          const customError = this.error.get("setupListeners", err, true);

          return reject(customError);
        }

        this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
        PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.REDIS);
        PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.ON_ERROR, 1, LOCATOR_SERVICE_NAME.REDIS);
      });

      this.client.on("ready", () => {
        this.firstConnection = false;
        this.onReady();
        resolve();
      });
    });
  }

  private onReady = () => {
    this.onHealth(LOCATOR_SERVICE_HEALTH.GOOD);
    PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.IS_ALIVE, 1, LOCATOR_SERVICE_NAME.REDIS);
    PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.CONNECTED, 1, LOCATOR_SERVICE_NAME.REDIS);
    this.logger.info("Client is ready");
  };

  public async disconnect(): Promise<void> {
    this.logger.info("Service stopped");
    this.onHealth(LOCATOR_SERVICE_HEALTH.STOPPED);
    PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.REDIS);
    PrometheusService.setExternalServicesStatusMetrics(ERedisStatusEvent.STOPPED, 1, LOCATOR_SERVICE_NAME.REDIS);

    try {
      const unsubscribePromises = this.unsubscribeFns.map((unsubscribe) => unsubscribe());

      this.unsubscribeFromEvents();

      if (this.client) {
        this.client.removeAllListeners();
        unsubscribePromises.push(this.client.quit().then(() => {}));
      }

      await Promise.all(unsubscribePromises);
    } catch (error) {
      this.logger.error("[disconnect] Error during disconnection", error);
    }

    this.firstConnection = true;
    this.client = null;
    this.redlock = null;
  }

  private async subscribeToEvents(): Promise<void> {
    if (!this.client) this.handleThrowError("Client not found");

    try {
      if (getCoreConfig().env === "local") await this.configureEventsAccess();

      this.eventSubscription = this.client.duplicate();

      const EVENT_EXPIRED = `__keyevent@${this.redisConfig.database}__:expired`;

      this.logger.info(`Subscribing to "${EVENT_EXPIRED}" event`);

      this.eventSubscription.subscribe(EVENT_EXPIRED);
      this.eventSubscription.on("message", (channel, key) => {});
    } catch (err) {
      this.logger.error("[subscribeToEvents]", err);
    }
  }

  private async unsubscribeFromEvents(): Promise<void> {
    this.eventSubscription?.quit();
  }

  private configureEventsAccess = async () => {
    try {
      if (!this.client) return;

      // "KEA" stands for all events but "missing keys" and "new keys"
      // check other options here: https://redis.io/docs/manual/keyspace-notifications/
      await this.client.config("SET", "notify-keyspace-events", "KEA");
      const config = await this.client.config("GET", "notify-keyspace-events");

      this.logger.info("notify-keyspace-events config:", config);
    } catch (err) {
      this.logger.info("[configureEventsAccess]", err);
    }
  };

  private get = async (key: string, baseKey: ERedisKey, shouldParse = true): Promise<any | null> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      const value = await this.client.get(key);

      if (!value) return null;

      if (!shouldParse) return value;

      const parsed = JSON.parse(value);

      return parsed;
    } catch (err) {
      this.logger.error("[get]", err);

      return null;
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.GET, Date.now() - start);
    }
  };

  private async incr(key: string): Promise<any> {
    if (!this.client) this.handleThrowError("Client not found");

    try {
      await this.client.incr(key);
    } catch (error) {
      this.logger.error(`[generalMetricsIncrement] Error incrementing key ${key}: ${error}`);
    }
  }

  private pipeline(): ChainableCommander | undefined {
    if (!this.client) this.handleThrowError("Client not found");

    return this.client.pipeline();
  }

  private set = async (key: string, value: any, baseKey: ERedisKey, shouldStringify = true): Promise<void> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      const result = await this.client.set(key, shouldStringify ? JSON.stringify(value) : value);

      if (result !== "OK") {
        this.error.throw("set", `Result is NOT "OK". Result: ${JSON.stringify(result)}`, true, { key });
      }
    } catch (err) {
      this.logger.error("[set]", err);
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.SET, Date.now() - start);
    }
  };

  private async mget(keys: string[], baseKey: ERedisKey): Promise<(string | null)[]> {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      return await this.client.mget(keys);
    } catch (error) {
      this.logger.error(`[mget] ${keys.join(", ")}: ${error}`);

      return keys.map(() => null);
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.MGET, Date.now() - start);
    }
  }

  private delete = async (key: string, baseKey: ERedisKey): Promise<void> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error("[delete]", err);
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.DELETE, Date.now() - start);
    }
  };

  private setExpiration = async (key: string, timeoutSeconds: number, baseKey: ERedisKey): Promise<boolean> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      const set = await this.client.expire(key, timeoutSeconds);

      if (set) return true;

      this.logger.error(`[setExpiration] Returned false for key "${key}"`);

      return false;
    } catch (err) {
      this.logger.error("[[setExpiration]", err);

      return false;
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.SET_EXP, Date.now() - start);
    }
  };

  private getKeysByPatternEfficient = async (keyPattern: string, baseKey: ERedisKey): Promise<string[]> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      const keys: string[] = [];
      const stream = this.client.scanStream({ match: keyPattern, count: 100 });

      stream.on("data", (foundKeys) => {
        keys.push(...foundKeys);
      });
      await new Promise((resolve) => stream.on("end", resolve));

      return keys;
    } catch (err) {
      this.logger.error("[getKeysByPatternEfficient]", err);

      return [];
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.GET_PATTERN, Date.now() - start);
    }
  };

  private publish = async (channel: string, value: any, baseKey: ERedisKey, shouldStringify = true): Promise<void> => {
    if (!this.client) this.handleThrowError("Client not found");

    const start = Date.now();

    try {
      await this.client.publish(channel, shouldStringify ? JSON.stringify(value) : value);
    } catch (err) {
      this.logger.error("[publish]", err);
    } finally {
      PrometheusService.handleRedisRequestMetric(baseKey, ERedisOperationType.PUBLISH, Date.now() - start);
    }
  };

  private subscribe = async (subChanel: string, listener: CallbackFn): Promise<UnsubscribeFn> => {
    if (!this.client) this.handleThrowError("Client not found");

    try {
      const subscriber = this.client.duplicate();

      subscriber.on("error", (err) => this.logger.error(`Error from ${subChanel} channel subscriber: `, err));
      await subscriber.subscribe(subChanel);

      subscriber.on("message", (channel, message) => {
        if (channel === subChanel) {
          listener(message, channel);
        }
      });

      const unsubscribe = async () => {
        await subscriber.unsubscribe(subChanel);
        await subscriber.quit();
      };

      this.unsubscribeFns.push(unsubscribe);

      return unsubscribe;
    } catch (err) {
      this.logger.error("[subscribe]", err);

      this.handleThrowError("Subscription failed");
    }
  };

  private onHealth(health: LOCATOR_SERVICE_HEALTH) {
    this.health = health;
    this.emit(LOCATOR_SERVICE_EVENT.HEALTH_CHANGE, this.health);
  }

  private handleThrowError(message: string, extra: any = ""): never {
    return this.error.throw("handleThrowError", message, true, { extra });
  }
}
