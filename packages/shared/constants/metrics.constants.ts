import { APP_NAME } from "@shared/interfaces";

export enum ECounterName {
  // global
  REDIS_REQUEST = "redis_request",
}

export enum EGaugeName {
  // rabbitMQ status
  RABBIT_MQ_STATUS = "rabbitMQ_status",
  // redis status
  REDIS_STATUS = "redis_status",
  // s3 status
  S3_STATUS = "s3_status",
  // global
  REDIS_REQUEST_MAX_MS = "redis_request_max_ms",
  REDIS_REQUEST_AVG_MS = "redis_request_avg_ms",
}

export enum ELabels {
  // rabbitMQ status
  RABBIT_MQ_STATUS = "rabbitMQ_status",
  // redis status
  REDIS_STATUS = "redis_status",
  // s3 status
  S3_STATUS = "s3_status",
  // global
  REDIS_REQUEST = "redis_request",
  REDIS_REQUEST_MAX_MS = "redis_request_max_ms",
  REDIS_REQUEST_AVG_MS = "redis_request_avg_ms",
}

export enum ERabbitStatusEvent {
  IS_ALIVE = "is_alive",
  CONNECTED = "connected",
  RECONNECTING= "reconnecting",
  ON_DISCONNECTED = "on_disconnected",
  MAX_RECONNECT_TIMEOUT = "max_reconnect_duration",
  ON_UNEXPECTED_DISCONNECTED = "on_unexpected_disconnected",
  STOPPED = "stopped",
  FALLEN_MESSAGES = "fallen_messages",
  PUBLISH_FALLEN_MESSAGES = "publish_fallen_messages ",
}

export enum ERedisStatusEvent {
  IS_ALIVE = "is_alive",
  CONNECTED = "connected",
  RECONNECTING= "reconnecting",
  ON_ERROR = "on_error",
  NO_CLIENT= "no_client",
  STOPPED = "stopped",
}

export enum ES3StatusEvent {
  IS_ALIVE = "is_alive",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  STOPPED = "stopped",
}

interface IMetricItem {
  type: "gauge" | "counter";
  name: ECounterName | EGaugeName;
  help: string;
  label?: ELabels;
}

export const renderServiceMetrics: IMetricItem[] = [
  // essential services
  {
    type: "gauge",
    name: EGaugeName.REDIS_STATUS,
    help: "Redis service status",
    label: ELabels.REDIS_STATUS,
  },
  {
    type: "gauge",
    name: EGaugeName.RABBIT_MQ_STATUS,
    help: "rabbitMQ service status",
    label: ELabels.RABBIT_MQ_STATUS,
  },
  {
    type: "gauge",
    name: EGaugeName.S3_STATUS,
    help: "S3 service status",
    label: ELabels.S3_STATUS,
  },
  // redis global
  {
    type: "counter",
    name: ECounterName.REDIS_REQUEST,
    help: "Redis requests by <key>_<type>",
    label: ELabels.REDIS_REQUEST,
  },
  {
    type: "gauge",
    name: EGaugeName.REDIS_REQUEST_AVG_MS,
    help: "Redis requests avg ms by <key>_<type>",
    label: ELabels.REDIS_REQUEST_AVG_MS,
  },
  {
    type: "gauge",
    name: EGaugeName.REDIS_REQUEST_MAX_MS,
    help: "Redis requests max ms by <key>_<type>",
    label: ELabels.REDIS_REQUEST_MAX_MS,
  },
];

export const serviceMetrics: Partial<{ [key in APP_NAME]: IMetricItem[] }> = {
  [APP_NAME.RENDERER]: renderServiceMetrics,
};
