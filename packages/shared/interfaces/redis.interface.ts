export interface IRedisConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: undefined | object;
  masterName: string;
  delayBeforeDelete: number;
  database: number;
  expiration: {
    amqpMessages: number;
  };
}
