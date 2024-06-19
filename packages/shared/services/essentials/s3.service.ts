import { EventEmitter } from "stream";

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { getStorageConfig } from "@shared/configs";
import { ES3StatusEvent } from "@shared/constants";
import { ILocatorService, LOCATOR_SERVICE_EVENT, LOCATOR_SERVICE_HEALTH, LOCATOR_SERVICE_NAME } from "@shared/interfaces";
import { PrometheusService, ErrorHandler } from "@shared/services";
import { Logger, retry } from "@shared/utils";

const MAX_CONNECTION_ATTEMPTS = 3; // for first time
const CONNECTION_ATTEMPT_INTERVAL = 5000;
const CONNECTION_ATTEMPT_INTERVAL_MULTIPLIER = 1.5;

export interface IS3ClientService {
   instance: S3Client,
}

export class S3StorageService extends EventEmitter implements ILocatorService {
  private config = getStorageConfig();

  private instance: S3Client | null = null;

  private error = new ErrorHandler("S3StorageService");

  private logger = new Logger("S3StorageService", "debug");

  private health = LOCATOR_SERVICE_HEALTH.NOT_INITIALIZED;

  private attemptsCounter = 0;

  private firstConnection = true;

  constructor() {
    super();
  }

  /**
   * Method used for both manual connection and further reconnects
   * @param attempts how much times we retry the connection for first launch
   * @param interval how much MS we wait till retry
   * @param multiplier how much we multiply the interval after each failed attempt
   */
  public connect = async (attempts = MAX_CONNECTION_ATTEMPTS, interval = CONNECTION_ATTEMPT_INTERVAL, multiplier = CONNECTION_ATTEMPT_INTERVAL_MULTIPLIER) => {
    try {
      this.logger.info("Trying to connect");

      await retry(
        attempts,
        interval,
        multiplier,
        async () => {
          if (!this.instance) {
            this.initInstance();
          }

          await this.firstProcessingCheck();
        },
        () => {
          this.logger.warn("Reconnection attempt");
          if (this.attemptsCounter < MAX_CONNECTION_ATTEMPTS) {
            this.attemptsCounter++;
          }
        },
      );
    } catch (error) {
      if (this.firstConnection && this.attemptsCounter === MAX_CONNECTION_ATTEMPTS) {
        this.error.throw("connect", error, true);
      } else {
        PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.RECONNECTING, 1, LOCATOR_SERVICE_NAME.S3);
        this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
        this.connect();
      }

      this.logger.error(`Error while establishing a connection ${JSON.stringify(error)}`);
    }
  };

  public async disconnect(): Promise<void> {
    this.logger.info("Service stopped");
    this.onHealth(LOCATOR_SERVICE_HEALTH.STOPPED);
    PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.STOPPED, 1, LOCATOR_SERVICE_NAME.S3);
    this.firstConnection = true;
    this.instance = null;
  }

  /**
   * The method that is used by Service Locator to get only
   * those methods that should be available to others
   */
  public getPublicInstance = (): IS3ClientService => {
    if (!this.instance) {
      return this.error.throw("getPublicInstance", "Instance not found", true);
    }

    return {
      instance: this.instance,
    };
  };

  private initInstance() {
    this.instance = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.key,
        secretAccessKey: this.config.secret,
      },
      maxAttempts: this.config.maxAttempts,
    });
  }

  private async firstProcessingCheck(): Promise<void> {
    const key = this.getHealthCheckKey();

    try {
      await this.testCreate(key);
      await this.testDelete(key);

      this.firstConnection = false;
      this.logger.info("Client is ready");
      this.onHealth(LOCATOR_SERVICE_HEALTH.GOOD);
      PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.CONNECTED, 1, LOCATOR_SERVICE_NAME.S3);
      PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.IS_ALIVE, 1, LOCATOR_SERVICE_NAME.S3);

      setTimeout(() => this.processingCheck(), 30000);
    } catch (error) {
      this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
      PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.S3);
      this.error.throw("firstProcessingCheck", error, true, { key });
    }
  }

  private async processingCheck(): Promise<void> {
    const key = this.getHealthCheckKey();

    try {
      // eslint-disable-next-line prefer-promise-reject-errors
      const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject({ error: "Time out" }), ms));

      await Promise.race([this.testCreate(key), timeout(10000)]);
      await Promise.race([this.testDelete(key), timeout(10000)]);

      if (this.health === LOCATOR_SERVICE_HEALTH.BAD) {
        PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.CONNECTED, 1, LOCATOR_SERVICE_NAME.S3);
      }

      this.onHealth(LOCATOR_SERVICE_HEALTH.GOOD);
      PrometheusService.setExternalServicesStatusMetrics(ES3StatusEvent.IS_ALIVE, 1, LOCATOR_SERVICE_NAME.S3);
    } catch (error) {
      this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
      this.error.throw("processingCheck", error, true, { key });
    }

    setTimeout(() => {
      this.processingCheck();
    }, 30000);
  }

  private async testCreate(key: string): Promise<void> {
    const upload = new Upload({
      client: this.instance!,
      params: {
        Key: key,
        Body: "",
        ...this.config.uploadConfigs.public.text,
      },
    });

    try {
      await upload.done();
    } catch (error) {
      this.error.throw("testCreate", error, false, { key });
    }
  }

  private async testDelete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: getStorageConfig().bucket,
      Key: key,
    });

    try {
      await this.instance!.send(command);
    } catch (error) {
      this.error.throw("testDelete", error, false, { key });
    }
  }

  private getHealthCheckKey(): string {
    const timeStamp = new Date().getTime().toString();

    return `${this.config.prefixes.base}/${this.config.prefixes.health}/${timeStamp}`;
  }

  private onHealth(health: LOCATOR_SERVICE_HEALTH) {
    this.health = health;
    this.emit(LOCATOR_SERVICE_EVENT.HEALTH_CHANGE, this.health);
  }
}
