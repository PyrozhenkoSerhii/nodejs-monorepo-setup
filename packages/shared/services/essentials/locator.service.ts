import { EventEmitter } from "stream";

import { LOCATOR_SERVICE_NAME, LOCATOR_SERVICE_EVENT, LOCATOR_SERVICE_HEALTH, ILocatorService } from "@shared/interfaces";
import { RabbitService, IRabbitMqServicePublic, IRedisClientService, IS3ClientService, S3StorageService, RedisService } from "@shared/services";
import { Logger } from "@shared/utils";

type IServicesMap = { [key in LOCATOR_SERVICE_NAME]?: ILocatorService };

type IHealthSummaryMap = { [key in LOCATOR_SERVICE_NAME]?: LOCATOR_SERVICE_HEALTH };

interface IServiceHealthSummaryItem {
  serviceName: string;
  isHealthy: boolean;
  message?: string;
}

export class ServiceLocator extends EventEmitter {
  private static logger = new Logger("ServiceLocator", "debug");

  private static services: IServicesMap = {};

  private static initialized = false;

  public static healthSummary: IHealthSummaryMap = {};

  /**
   * Should be called before "connect()" method to add services for the app
   * @param service the service (external dependency) that should be initialized before the startup
   * @param name name of the service for health and other metrics
   */
  public static addService(service: ILocatorService, name: LOCATOR_SERVICE_NAME): void {
    if (ServiceLocator.initialized) return ServiceLocator.handleThrowError("[addService] Cannot add service after locator initialization");

    ServiceLocator.services[name] = service;

    service.on(LOCATOR_SERVICE_EVENT.HEALTH_CHANGE, (health) => ServiceLocator.onHealthChange(name, health));
  }

  /**
   * Used to start all services that were provided beforehand
   * If some services weren't able to start, throws an error that leads to process.exit(1)
   */
  public static connect = async () => {
    ServiceLocator.initialized = true;

    const serviceEntries = Object.entries(ServiceLocator.services).filter(
      (entry): entry is [LOCATOR_SERVICE_NAME, ILocatorService] => entry[1] !== undefined,
    );
    const results = await Promise.allSettled(serviceEntries.map(([_, service]) => service.connect()));

    const summary = {
      total: serviceEntries.length,
      successful: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length,
      failedServices: results
        .map<IServiceHealthSummaryItem>((r, index) => ({
          isHealthy: r.status === "fulfilled",
          serviceName: serviceEntries[index][0], // Use the enum key as the serviceName
          message: r.status === "rejected" ? (r as PromiseRejectedResult).reason : undefined,
        }))
        .filter((r) => !r.isHealthy),
    };

    if (summary.failed) {
      await ServiceLocator.disconnect();
      ServiceLocator.handleThrowError(
        `[connect] ${summary.failed}/${summary.total} services failed to launch`,
        summary.failedServices,
      );
    } else {
      ServiceLocator.logger.success(`[connect] ${summary.successful}/${summary.total} services started successfully`);
    }
  };

  /**
   * Used to gracefully stop all services
   * Mainly used for the shutdown
   */
  public static disconnect = async () => {
    const serviceEntries = Object.entries(ServiceLocator.services).filter(
      (entry): entry is [LOCATOR_SERVICE_NAME, ILocatorService] => entry[1] !== undefined,
    );
    const results = await Promise.allSettled(serviceEntries.map(([_, service]) => service.disconnect()));
    const summary = {
      total: serviceEntries.length,
      successful: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length,
      failedServices: results
        .map<IServiceHealthSummaryItem>((r, index) => ({
          isHealthy: r.status === "fulfilled",
          serviceName: serviceEntries[index][0], // Use the enum key as the serviceName
          message: r.status === "rejected" ? (r as PromiseRejectedResult).reason : undefined,
        }))
        .filter((r) => !r.isHealthy),
    };

    if (summary.failed) {
      ServiceLocator.logger.error(
        `[disconnect] ${summary.failed}/${summary.total} services failed to stop gracefully`,
        summary.failedServices,
      );
    } else {
      ServiceLocator.logger.success(`[disconnect] ${summary.successful}/${summary.total} services stopped gracefully`);
    }
  };

  /**
   * @returns a StorageService instance that can be used to create a channel, etc
   */
  public static getRabbitMQ = (): IRabbitMqServicePublic => {
    const service = ServiceLocator.services[LOCATOR_SERVICE_NAME.RABBIT_MQ];

    if (!service) {
      ServiceLocator.handleThrowError("[getRabbitMQ] Service is not initialized");
    }

    if (!(service instanceof RabbitService)) {
      ServiceLocator.handleThrowError("[getRabbitMQ ] Service is not an instance of rabbitMQ");
    }

    return service.getPublicInstance();
  };

  /**
   * @returns a S3 service that can be used to create a channel, etc
   */
  public static getStorageService = (): IS3ClientService => {
    const service = ServiceLocator.services[LOCATOR_SERVICE_NAME.S3];

    if (!service) {
      ServiceLocator.handleThrowError("[getStorageService] Service is not initialized");
    }

    if (!(service instanceof S3StorageService)) {
      ServiceLocator.handleThrowError("[getStorageService ] Service is not an instance of S3Service");
    }

    return service.getPublicInstance();
  };

  /**
   * @returns Redis client service
   */
  public static getRedisServices(): IRedisClientService {
    const service = ServiceLocator.services[LOCATOR_SERVICE_NAME.REDIS];

    if (!service) {
      ServiceLocator.handleThrowError("[getRedisServices] Service is not initialized");
    }

    if (!(service instanceof RedisService)) {
      ServiceLocator.handleThrowError("[getRedisServices] Service is not an instance of RedisBase");
    }

    return service.getPublicInstance();
  }

  private static handleThrowError(message: string, extra: any = ""): never {
    ServiceLocator.logger.error(message, extra);
    throw new Error(message);
  }

  private static onHealthChange = async (name: LOCATOR_SERVICE_NAME, health: LOCATOR_SERVICE_HEALTH) => {
    this.healthSummary[name] = health;
    if (health === LOCATOR_SERVICE_HEALTH.CRITICAL) {
      ServiceLocator.logger.error(`Stopping all services and exiting due to ${name} having a "${health}" health`);
      await ServiceLocator.disconnect();
      await ServiceLocator.report();
      process.exit(1);
    }
  };

  private static report = async () => {
    // report the failures here
  };
}
