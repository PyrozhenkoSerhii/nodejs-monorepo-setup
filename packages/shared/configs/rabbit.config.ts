import { IRabbitConfig } from "@shared/interfaces";
import { Logger, tryGetEnv } from "@shared/utils";

const buildRabbitUri = ({ host, port, user, password, vhost }: any) => {
  // tls is used for prod/dev on AWS, no need to use it locally
  const protocol = process.env.NODE_ENV === "local" ? "amqp" : "amqps";

  return host && port && user && password
    ? `${protocol}://${user}:${password}@${host}:${port}/${vhost}`
    : `${protocol}://rabbitmq:5672`;
};

let config: IRabbitConfig|null;

export const getRabbitConfig = (): IRabbitConfig => {
  if (!config) {
    const rabbitCreds = {
      user: tryGetEnv("RABBIT_USER"),
      password: tryGetEnv("RABBIT_PASSWORD"),
      host: tryGetEnv("RABBIT_HOST"),
      port: tryGetEnv("RABBIT_PORT"),
      vhost: tryGetEnv("RABBIT_VHOST", ""),
      env: tryGetEnv("NODE_ENV"),
    };

    config = {
      uri: buildRabbitUri(rabbitCreds),
      queues: {
        renderer_job: `transcoding_${rabbitCreds.env}`,
      },
      queueMessagesLimit: {
        renderer_job: 2,
      },
      dlx: {
        exchangeName: `my.dlx_${rabbitCreds.env}`,
        queueName: `dead-letter-queue_${rabbitCreds.env}`,
        routingKey: "#", // Using '#' for routing key to accept all messages
      },
      healthCheckSeconds: 5, // [5;20] are optimal, <5 will likely to cause false positives
      connectionTimeoutMs: 1000, // for how long the amqplib will be waiting for connection establishment before timing out
      queueType: tryGetEnv("RABBIT_QUEUE_TYPE", "") || undefined,
      liveliness: {
        maxReconnectMs: 60 * 1000,
      },
    };

    Logger.log("[rabbitConfig]", {
      host: rabbitCreds.host,
      port: rabbitCreds.port,
      user: rabbitCreds.user,
      vhost: rabbitCreds.vhost,
      env: rabbitCreds.env,
      queueType: config.queueType,
      dlx: config.dlx,
      liveliness: config.liveliness,
    });
  }

  return config;
};
