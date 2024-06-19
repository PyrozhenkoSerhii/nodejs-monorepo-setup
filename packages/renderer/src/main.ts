import { createServer } from "http";

import express, { Request, Response } from "express";

import { getCoreConfig } from "@shared/configs";
import { PATH } from "@shared/constants";
import { LOCATOR_SERVICE_NAME } from "@shared/interfaces";
import { RabbitService, RedisService, S3StorageService, ServiceLocator, FileSystemService, PrometheusService } from "@shared/services";
import { Logger } from "@shared/utils";

class Main {
  private logger = new Logger("Main");

  private coreConfig = getCoreConfig();

  public initialize = async () => {
    try {
      PrometheusService.init();

      ServiceLocator.addService(new RabbitService(), LOCATOR_SERVICE_NAME.RABBIT_MQ);
      ServiceLocator.addService(new S3StorageService(), LOCATOR_SERVICE_NAME.S3);
      ServiceLocator.addService(new RedisService(), LOCATOR_SERVICE_NAME.REDIS);
      await ServiceLocator.connect();

      await FileSystemService.initializeFolders();

      const app = express();

      app.use(`/${PATH.HEALTH}`, this.onHealth);

      const httpServer = createServer(app);

      httpServer.listen(this.coreConfig.port, () => {
        this.logger.success(`[Express] Server started on port ${this.coreConfig.port}`);
      });
    } catch (error) {
      this.logger.error("[initialize] Critical error occurred. Existing", error);
      process.exit(1);
    }
  };

  private onHealth = (_: Request, res: Response) => res.status(200).send({ appName: this.coreConfig.appName, healthSummary: ServiceLocator.healthSummary });
}

new Main().initialize();
