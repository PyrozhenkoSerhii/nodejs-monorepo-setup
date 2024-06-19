import EventEmitter from "events";

import amqplib from "amqplib";

import { getRabbitConfig } from "@shared/configs";
import { ERabbitStatusEvent } from "@shared/constants";
import { ILocatorService, IRabbitConfig, LOCATOR_SERVICE_EVENT, LOCATOR_SERVICE_HEALTH, LOCATOR_SERVICE_NAME } from "@shared/interfaces";
import { ErrorHandler, PrometheusService, RedisService } from "@shared/services";
import { Logger, retry } from "@shared/utils";

import { RedisAmqpMessagesService } from "../redis";

const MAX_CONNECTION_ATTEMPTS = 3; // for first start
const CONNECTION_ATTEMPT_INTERVAL = 5000;
const CONNECTION_ATTEMPT_INTERVAL_MULTIPLIER = 1.5;

type TOnMessage = (message: any) => any;

export enum RABBIT_QUEUE_ALIAS {
  RENDERER_JOB = "renderer_job",
}

export interface IRabbitMqServicePublic {
  createSubscriber: (queueAlias: RABBIT_QUEUE_ALIAS, onMessage: (message: any) => Promise<void>) => Promise<boolean>;
  publishMessage: (data: AmqpQueueEntry) => Promise<boolean>;
}

export interface AmqpQueueEntry {
  queueAlias: RABBIT_QUEUE_ALIAS;
  message: any;
  ttl?: number;
}

interface Subscriber {
  queueAlias: string;
  onMessage: TOnMessage;
}

export class RabbitService extends EventEmitter implements ILocatorService {
  private logger = new Logger("RabbitService", "debug");

  private readonly config: IRabbitConfig = getRabbitConfig();

  protected connection: amqplib.Connection | null = null;

  private health = LOCATOR_SERVICE_HEALTH.NOT_INITIALIZED;

  private error = new ErrorHandler("RabbitService");

  /**
   * The channel that is used for publishing messages and DLX implementation
   */
  private mainChannel: amqplib.Channel | null = null;

  /**
   * The queues that are attached to the main channel for publishing messages
   * Used to reduce load by ensuring the queue only once
   */
  private assertedQueues: Set<RABBIT_QUEUE_ALIAS> = new Set();

  /**
   * The channels that are created for each separate queue
   * We store created subscribers for re-creation
   */
  private subscriberChannels: { [queueAlias in RABBIT_QUEUE_ALIAS]?: amqplib.Channel } = {};

  /**
   * Store created subscribers for re-creation
   */
  private subscribers: Set<Subscriber> = new Set();

  /**
   * The buffer that is used for retry when publishing
   * When the amqp service is unhealthy, we push the message and its expiration time to the array
   * When the amqp service is healthy again, we publish all messages that are still relevant
   */
  private messageBuffer:AmqpQueueEntry[] = [];

  private livelinessTimeout: NodeJS.Timeout | null = null;

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
          this.connection = await amqplib.connect(this.config.uri, { timeout: this.config.connectionTimeoutMs });
          this.mainChannel = await this.connection.createChannel();
          await this.setupDLX();
          this.subscribeToEvents();
          this.onConnected();
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
        this.error.throw("connect", error);
      } else {
        PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.RECONNECTING, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
        this.connect();
      }

      this.logger.error("Error while establishing a connection", JSON.stringify(error));
    }
  };

  /**
   * Method that is used for manual disconnection from outside
   * It should close all connections gracefully
   */
  public disconnect = async () => {
    if (this.messageBuffer.length > 0) {
      const messageBuffer: any[] = [];

      this.messageBuffer.forEach((message) => {
        messageBuffer.push(RedisAmqpMessagesService.storeFallenAmqpQueueEntry(message));
      });

      await Promise.all(messageBuffer);
    }

    this.logger.info("Service stopped");
    this.onHealth(LOCATOR_SERVICE_HEALTH.STOPPED);
    PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.STOPPED, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
    try {
      await this.clearConnection(true, true);
    } catch (error) {
      this.error.throw("disconnect", error);
    }
  };

  /**
   * The method that is used by Service Locator to get only
   * those methods that should be available to others
   */
  public getPublicInstance = (): IRabbitMqServicePublic => ({
    createSubscriber: this.createSubscriber,
    publishMessage: this.publishMessage,
  });

  private onConnected = () => {
    this.firstConnection = false;
    this.onHealth(LOCATOR_SERVICE_HEALTH.GOOD);
    this.cancelLivelinessTimeout();
    this.logger.info("Client is ready");
    PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.IS_ALIVE, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
    PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.CONNECTED, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
    this.retryMessages();
  };

  private subscribeToEvents = () => {
    if (!this.connection) return;

    this.connection.on("close", this.onDisconnected);
    this.connection.on("error", this.onUnexpectedError);
  };

  private unsubscribeFromEvents = () => {
    if (!this.connection) return;

    this.connection.off("close", this.onDisconnected);
    this.connection.off("error", this.onUnexpectedError);
  };

  private onDisconnected = async () => {
    try {
      this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.RABBIT_MQ);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.ON_DISCONNECTED, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
      this.setupLivelinessTimeout();
      this.logger.error("[onDisconnected]");
      // manual reconnect cycle
      this.clearConnection(false);
      await this.connect();
      this.recreateSubscribers();
    } catch (error) {
      this.logger.error("[onDisconnected]:", error);
    }
  };

  private onUnexpectedError = async (error: any) => {
    try {
      // TODO: these should be addressed with care and depending on what
      // errors were actually getting
      // For now, we assume that all of those are critical and trying to reconnect
      this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.RABBIT_MQ);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.ON_UNEXPECTED_DISCONNECTED, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
      this.setupLivelinessTimeout();
      this.logger.error("[onUnexpectedError] event. Actual error: ", error);
      // manual reconnect cycle
      this.clearConnection(true);
      await this.connect();
      this.recreateSubscribers();
    } catch (error) {
      this.logger.error("[onUnexpectedError] event [catch] ERROR:", error);
    }
  };

  /**
   * The method that is used for subscribing to a specified queue.
   * A new channel will be created for each queue and will have its own
   * processing count which will limit how many "active" (unacked) messages can be present at once
   * If we reached the maxProcessing, no new messages will be received until at least 1 is finished
   * All messages that are failed are sent to DLX queue for further logging
   * Node: it's important to ensure that "assertQueue" in createSubscriber() and ensureMainQueue() methods
   * have the same parameters during creation since there's no way of knowing where it will be created first
   * @param queueAlias the alias of the queue we need to listen to (the name is env based so we can't use it)
   * @param onMessage the handler for the message
   * @returns true - if successfully subscribed, false - if got some error
   */
  public createSubscriber = async (queueAlias: RABBIT_QUEUE_ALIAS, onMessage: (message: any) => Promise<void>): Promise<boolean> => {
    try {
      const queueName = this.config.queues[queueAlias as keyof typeof this.config.queues];
      const maxProcessing = this.config.queueMessagesLimit[queueAlias as keyof typeof this.config.queueMessagesLimit];

      if (!this.connection) return this.error.throw("createSubscriber", "Unexpected RabbitMQ service state. No connection found", true, { queueAlias });

      const subscriberChannel = await this.connection.createChannel();

      // setting the max amount of the unacknowledged messages on the channel
      // if everything is okay, the channel should ack() the message
      // you should nack() with requeue if the error is recoverable (TODO: need more info about the error happened in onMessage())
      // you should nack() without requeue and send message to DLX if the error is fatal
      subscriberChannel.prefetch(maxProcessing);
      await subscriberChannel.assertQueue(queueName, {
        durable: true,
      });

      subscriberChannel.consume(
        queueName,
        async (message) => {
          if (!message?.content) return this.error.throw("createSubscriber", "No message content", true, { message });

          try {
            await onMessage(JSON.parse(message.content.toString()));
            subscriberChannel.ack(message);
          } catch (error) {
            // TODO: depending on the actual error from the onMessage() we may consider adjusting "requeue" variable
            const requeue = false;

            subscriberChannel.nack(message, false, requeue);
            this.logger.error(`Error while handling the message for "${queueName}" queue`, error);
          }
        },
        { noAck: false },
      );

      this.subscriberChannels[queueAlias] = subscriberChannel;

      this.subscribers.add({
        queueAlias,
        onMessage,
      });

      this.logger.info(`[createSubscriber] New channel and queue for "${queueName}", prefetch: ${maxProcessing}`);

      return true;
    } catch (error) {
      this.logger.error("[createSubscriber] Failed", error);

      return false;
    }
  };

  /**
 * The method that recreates subscribers in case of connection loss or other critical events
 */
  private recreateSubscribers = async () => {
    try {
      await Promise.all(
        Array.from(this.subscribers).map((subscriber) => this.createSubscriber(subscriber.queueAlias as RABBIT_QUEUE_ALIAS, subscriber.onMessage)),
      );
    } catch (error) {
      this.logger.error("Failed to recreateSubscribers", error);
    }
  };

  /**
   * Used to send publish a message to the specified queue
   * @returns {boolean} true - if succeeded, false - if got some error
   */
  public publishMessage = async (data: AmqpQueueEntry): Promise<boolean> => {
    if (!this.connection) {
      this.messageBuffer.push(data);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.FALLEN_MESSAGES, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);

      return this.error.throw("publishMessage", "No connection found", true, { data });
    }

    try {
      if (!this.mainChannel) {
        this.messageBuffer.push(data);
        PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.FALLEN_MESSAGES, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);

        return this.error.throw("publishMessage", "Unexpected RabbitMQ service state. No channel found", true, { data });
      }

      if (this.health !== LOCATOR_SERVICE_HEALTH.GOOD) return this.error.throw("publishMessage", `The service is unhealthy (${this.health}), can't schedule a message`, true, { data });

      await this.ensureMainQueue(data.queueAlias);

      this.sendToQueue(this.mainChannel, data.queueAlias, data.message);

      return true;
    } catch (error) {
      this.logger.error("Failed to publish message, message added to messageBuffer", error);

      return false;
    }
  };

  private retryMessages = async () => {
    const fallenMessages = await RedisAmqpMessagesService.getFallenAmqpQueueEntries();

    if (this.messageBuffer.length > 0 || fallenMessages.length > 0) {
      this.logger.info(`[retryMessages] Got ${this.messageBuffer.length} messages in buffer.`);
      const messagesToRetry = [...this.messageBuffer, ...fallenMessages];

      this.messageBuffer = [];

      try {
        await Promise.all(messagesToRetry.map((m) => this.publishMessage(m)));
        PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.PUBLISH_FALLEN_MESSAGES, messagesToRetry.length, LOCATOR_SERVICE_NAME.RABBIT_MQ);
        this.logger.info("[retryMessages] All messages have been retried successfully.");
      } catch (error) {
        this.logger.error("[retryMessages] Error while retrying messages, re-adding to buffer.", error);

        // Re-add messages to buffer in case of error
        this.messageBuffer = [...messagesToRetry];
      }
    }
  };

  /**
   * If the queue is attached to DLX, all messages that are nack'ed will be sent to the DLX queue for further logging
   */
  private setupDLX = async () => {
    if (!this.mainChannel) return this.error.throw("setupDLX", "Unexpected RabbitMQ service state. No publisher channel found", true);

    await this.mainChannel.assertExchange(this.config.dlx.exchangeName, "direct", { durable: true });
    await this.mainChannel.assertQueue(this.config.dlx.queueName, { durable: true });
    await this.mainChannel.bindQueue(this.config.dlx.queueName, this.config.dlx.exchangeName, "#");
  };

  /**
   * The method that is used on the main channel for each queue that we attempt to send to
   * to ensure that it exists (and we ensure it only once)
   * Node: it's important to ensure that "assertQueue" in createSubscriber() and ensureMainQueue() methods
   * have the same parameters during creation since there's no way of knowing where it will be created first
   */
  private ensureMainQueue = async (queueAlias: RABBIT_QUEUE_ALIAS) => {
    if (!this.mainChannel) return this.error.throw("ensureMainQueue", "Unexpected RabbitMQ service state. No publisher channel found", true);

    if (this.assertedQueues.has(queueAlias)) return;

    const queueName = this.config.queues[queueAlias as keyof typeof this.config.queues];

    await this.mainChannel.assertQueue(queueName, {
      durable: true,
    });
    this.assertedQueues.add(queueAlias);

    this.logger.info(`[ensureMainQueue] Ensured "${queueName}" queue`);
  };

  private sendToQueue = (channel: amqplib.Channel, queueAlias: RABBIT_QUEUE_ALIAS, message: any) => {
    const queueName = this.config.queues[queueAlias];

    channel.sendToQueue(queueName, this.createBufferFromObject(message));

    this.logger.debug(`[sendToQueue] message to "${queueName}"`);
  };

  private createBufferFromObject = (obj: any): Buffer => Buffer.from(JSON.stringify(obj));

  private clearConnection = async (manualClose = false, shouldThrow = false) => {
    try {
      this.unsubscribeFromEvents();

      if (this.mainChannel) {
        try {
          await this.mainChannel.close();
        } catch (error) {
          if ((error as any)?.message !== "Channel closed") {
            this.logger.error("[clearConnection] Error while closing the main channel", error);
          }
        }
      }

      await Promise.all(Object.keys(this.subscriberChannels).map(async (key) => {
        const queueAlias = key as RABBIT_QUEUE_ALIAS;

        if (this.subscriberChannels[queueAlias]) {
          try {
            await this.subscriberChannels[queueAlias]?.close();
          } catch (error) {
            if ((error as any)?.message !== "Channel closed") {
              this.logger.error(`[clearConnection] Error while closing the subscriber channel "${key}"`, error);
            }
          }
        }
      }));

      if (manualClose) {
        this.subscriberChannels = {};
        this.subscribers.clear();
        this.messageBuffer = [];
        this.assertedQueues.clear();
        if (this.connection) {
          try {
            await this.connection.close();
          } catch (error) {
            if ((error as any)?.message !== "Connection closed") {
              this.logger.error("[clearConnection] Error while closing the connection", error);
            }
          }
        }
      }
    } catch (error) {
      if (shouldThrow) return this.error.throw("clearConnection", error, true);

      this.logger.error("[clearConnection] ERROR: ", error);
    } finally {
      this.firstConnection = true;
      this.connection = null;
    }
  };

  private setupLivelinessTimeout = () => {
    this.logger.warn(`[setupLivelinessTimeout] The service will become critical in ${this.config.liveliness.maxReconnectMs}ms`);
    this.livelinessTimeout = setTimeout(() => {
      this.logger.error("[setupLivelinessTimeout] [callback] The health is critical!");
      this.onHealth(LOCATOR_SERVICE_HEALTH.BAD);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.IS_ALIVE, 0, LOCATOR_SERVICE_NAME.RABBIT_MQ);
      PrometheusService.setExternalServicesStatusMetrics(ERabbitStatusEvent.MAX_RECONNECT_TIMEOUT, 1, LOCATOR_SERVICE_NAME.RABBIT_MQ);
    }, this.config.liveliness.maxReconnectMs);
  };

  private cancelLivelinessTimeout = () => {
    if (this.livelinessTimeout) {
      clearTimeout(this.livelinessTimeout);
      this.logger.info("[cancelLivelinessTimeout]");
    }
  };

  private onHealth = (health: LOCATOR_SERVICE_HEALTH) => {
    this.health = health;
    this.emit(LOCATOR_SERVICE_EVENT.HEALTH_CHANGE, this.health);
  };
}
