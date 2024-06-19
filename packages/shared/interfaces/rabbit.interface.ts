export interface IRabbitConfig {
  uri: string;
  queues: {
    renderer_job: string;
  };
  queueMessagesLimit: {
    renderer_job: number;
  };
  dlx: {
    exchangeName: string,
    queueName: string,
    routingKey: string
  },
  healthCheckSeconds: number,
  connectionTimeoutMs: number,
  queueType: string | undefined;
  liveliness: {
    maxReconnectMs: number;
  }
}
