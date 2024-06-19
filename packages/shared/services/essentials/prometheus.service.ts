/* eslint-disable @typescript-eslint/ban-ts-comment */
import { collectDefaultMetrics, Counter, Gauge } from "prom-client";

import { getCoreConfig } from "@shared/configs";
import {
  ECounterName,
  ELabels,
  EGaugeName,
  serviceMetrics,
  ERabbitStatusEvent,
  ERedisStatusEvent,
  ES3StatusEvent,
} from "@shared/constants";
import {
  LOCATOR_SERVICE_NAME,
} from "@shared/interfaces";
import { ERedisKey, ERedisOperationType } from "@shared/services";

const PREFIX = `${getCoreConfig().appName}_`;

const ServiceStatusEvents: { [key in LOCATOR_SERVICE_NAME]: any } = {
  [LOCATOR_SERVICE_NAME.RABBIT_MQ]: ERabbitStatusEvent,
  [LOCATOR_SERVICE_NAME.REDIS]: ERedisStatusEvent,
  [LOCATOR_SERVICE_NAME.S3]: ES3StatusEvent,
};

const ServiceGaugeNames: { [key in LOCATOR_SERVICE_NAME]: string } = {
  [LOCATOR_SERVICE_NAME.RABBIT_MQ]: EGaugeName.RABBIT_MQ_STATUS,
  [LOCATOR_SERVICE_NAME.REDIS]: EGaugeName.REDIS_STATUS,
  [LOCATOR_SERVICE_NAME.S3]: EGaugeName.S3_STATUS,
};

const ServiceLabelNames: { [key in LOCATOR_SERVICE_NAME]: string } = {
  [LOCATOR_SERVICE_NAME.RABBIT_MQ]: ELabels.RABBIT_MQ_STATUS,
  [LOCATOR_SERVICE_NAME.REDIS]: ELabels.REDIS_STATUS,
  [LOCATOR_SERVICE_NAME.S3]: EGaugeName.S3_STATUS,
};

type TStatusEvent = ERabbitStatusEvent | ERedisStatusEvent | ES3StatusEvent;

export class PrometheusService {
  private static gauges = new Map<string, Gauge>();

  private static counters = new Map<string, Counter>();

  private static redisRequestsPerformanceMetrics: { [key: string]: number[] } = {};

  private static rabbitStatusMetrics = new Map<ERabbitStatusEvent, number>();

  private static redisStatusMetrics = new Map<ERedisStatusEvent, number>();

  private static s3StatusMetrics = new Map<ES3StatusEvent, number>();

  static init(collectDefault = true) {
    if (collectDefault) collectDefaultMetrics({ prefix: PREFIX });

    console.log("[PrometheusService] Initialized");

    // @ts-ignore
    serviceMetrics[getCoreConfig().appName]?.forEach((m) => {
      if (m.type === "counter") {
        if (m.label) {
          this.createNewLabeledCounter(m.name, m.help, m.label);
        } else {
          this.createNewCounter(m.name, m.help);
        }
      } else if (m.type === "gauge") {
        if (m.label) {
          this.createLabeledGauge(m.name, m.help, m.label);
        } else {
          this.createGauge(m.name, m.help);
        }
      }
    });
  }

  static onServerMetricRequest() {
    PrometheusService.aggregateRedisPerformanceMetrics();
    PrometheusService.aggregateExternalServicesStatus(LOCATOR_SERVICE_NAME.REDIS);
    PrometheusService.aggregateExternalServicesStatus(LOCATOR_SERVICE_NAME.RABBIT_MQ);
    PrometheusService.aggregateExternalServicesStatus(LOCATOR_SERVICE_NAME.S3);
  }

  static handleRedisRequestMetric(requestName: ERedisKey, requestType: ERedisOperationType, ms: number) {
    const key = `${requestName}_${requestType}`;

    this.incrementLabeledCounter(ECounterName.REDIS_REQUEST, ELabels.REDIS_REQUEST, key);

    if (!this.redisRequestsPerformanceMetrics[key]) {
      this.redisRequestsPerformanceMetrics[key] = [];
    }

    this.redisRequestsPerformanceMetrics[key].push(ms);
  }

  private static aggregateRedisPerformanceMetrics() {
    Object.keys(this.redisRequestsPerformanceMetrics).forEach((key) => {
      const values = this.redisRequestsPerformanceMetrics[key];
      const max = Math.max(...values);
      const sum = values.reduce((acc, val) => acc + val, 0);
      const avg = sum / values.length || 0;

      this.setLabeledGauge(EGaugeName.REDIS_REQUEST_MAX_MS, ELabels.REDIS_REQUEST_MAX_MS, key, max);
      this.setLabeledGauge(EGaugeName.REDIS_REQUEST_AVG_MS, ELabels.REDIS_REQUEST_AVG_MS, key, avg);
    });

    this.redisRequestsPerformanceMetrics = {};
  }

  private static createLabeledGauge(name: string, help: string, label: string) {
    try {
      // @ts-ignore
      PrometheusService.gauges[name] = new Gauge({ name: this.getFullName(name), help, labelNames: [label] });
      console.info(`[PrometheusService] [createLabeledGauge] Created new gauge for ${this.getFullName(name)}`);
    } catch (error) {
      console.error(`[PrometheusService] [createLabeledGauge] ERROR for ${this.getFullName(name)}: `, error);
    }
  }

  private static createGauge(name: string, help: string) {
    try {
      // @ts-ignore
      PrometheusService.gauges[name] = new Gauge({ name: this.getFullName(name), help });
      console.info(`[PrometheusService] [createGauge] Created new gauge for ${this.getFullName(name)}`);
    } catch (error) {
      console.error(`[PrometheusService] [createGauge] ERROR for ${this.getFullName(name)}: `, error);
    }
  }

  private static createNewLabeledCounter(name: string, help: string, label: string) {
    try {
      // @ts-ignore
      PrometheusService.counters[name] = new Counter({ name: this.getFullName(name), help, labelNames: [label] });
      console.info(`[PrometheusService] [createNewLabeledCounter] Created new counter for ${this.getFullName(name)}`);
    } catch (error) {
      console.error(`[PrometheusService] [createNewLabeledCounter] ERROR for ${this.getFullName(name)}: `, error);
    }
  }

  private static createNewCounter(name: string, help: string) {
    try {
      // @ts-ignore
      PrometheusService.counters[name] = new Counter({ name: this.getFullName(name), help });
      console.info(`[PrometheusService] [createNewCounter] Created new counter for ${this.getFullName(name)}`);
    } catch (error) {
      console.error(`[PrometheusService] [createNewCounter] ERROR for ${this.getFullName(name)}: `, error);
    }
  }

  private static setGauge(name: string, value: number) {
    try {
      // @ts-ignore
      (PrometheusService.gauges[name] as Gauge).set(value);
    } catch (error) {
      console.error(`[PrometheusService] [setGauge] ERROR for ${{ name, value }}`, error);
    }
  }

  private static setLabeledGauge(name: string, labelName: string, labelValue: string, value: number) {
    try {
      // @ts-ignore
      (PrometheusService.gauges[name] as Gauge).labels({ [labelName]: labelValue }).set(value);
    } catch (error) {
      console.error(`[PrometheusService] [setLabeledGauge] ERROR for ${JSON.stringify({ name, labelName, labelValue, value })}`, error);
    }
  }

  public static incrementLabeledCounter(name: string, labelName: string, labelValue: string, incBy = 1) {
    try {
      // @ts-ignore
      (PrometheusService.counters[name] as Counter).inc({ [labelName]: labelValue }, incBy);
    } catch (error) {
      console.error(
        `[PrometheusService] [incrementLabeledCounter] ERROR for  ${JSON.stringify({ name, labelName, labelValue })}`,
        error,
      );
    }
  }

  public static incrementCounter(name: string, incBy = 1) {
    try {
      // @ts-ignore
      (PrometheusService.counters[name] as Counter).inc(incBy);
    } catch (error) {
      console.error(`[PrometheusService] [incrementCounter] ERROR for ${JSON.stringify({ name })}`, error);
    }
  }

  private static getFullName = (name: string): string => `${PREFIX}${name}`;

  // ExternalServicesStatusMetrics
  public static async setExternalServicesStatusMetrics(key: TStatusEvent, value: number, service: LOCATOR_SERVICE_NAME) {
    const metricsMap = this.getMetricsMap(service);

    if (!metricsMap) {
      console.error(`[PrometheusService] Unknown service: ${service}`);

      return;
    }

    const existedValue = metricsMap.get(key) || 0;
    const newValue = key === ERedisStatusEvent.IS_ALIVE || key === ERabbitStatusEvent.IS_ALIVE ? value : existedValue + value;

    metricsMap.set(key, newValue);
  }

  private static getMetricsMap(service: LOCATOR_SERVICE_NAME): Map<any, number> | undefined {
    switch (service) {
      case LOCATOR_SERVICE_NAME.RABBIT_MQ:
        return this.rabbitStatusMetrics;

      case LOCATOR_SERVICE_NAME.REDIS:
        return this.redisStatusMetrics;

      case LOCATOR_SERVICE_NAME.S3:
        return this.s3StatusMetrics;

      default:
        return undefined;
    }
  }

  public static aggregateExternalServicesStatus(service: LOCATOR_SERVICE_NAME) {
    const metricsMap = this.getMetricsMap(service);

    if (!metricsMap) {
      console.error(`[PrometheusService] Unknown service: ${service}`);

      return;
    }

    const aggregationMap = new Map<string, number>();

    this.initializeAggregationMap(service, aggregationMap);
    this.updateAggregates(metricsMap, aggregationMap, service);
    this.resetMetrics(metricsMap, service);
  }

  private static initializeAggregationMap(service: LOCATOR_SERVICE_NAME, aggregationMap: Map<string, number>) {
    const statusEvents = ServiceStatusEvents[service];

    Object.values(statusEvents).forEach((status) => {
      if (typeof status === "string") {
        aggregationMap.set(status, 0);
      }
    });
  }

  private static updateAggregates(metricsMap: Map<string, number>, aggregationMap: Map<string, number>, service: LOCATOR_SERVICE_NAME) {
    metricsMap.forEach((value, key) => {
      if (aggregationMap.has(key)) {
        aggregationMap.set(key, value);
      }
    });

    const gaugeName = ServiceGaugeNames[service];
    const labelName = ServiceLabelNames[service];

    aggregationMap.forEach((value, key) => {
      this.setLabeledGauge(gaugeName, labelName, key, value);
    });
  }

  private static resetMetrics(metricsMap: Map<string, number>, service: LOCATOR_SERVICE_NAME) {
    const statusEvents = ServiceStatusEvents[service];
    const isAliveKey = statusEvents.IS_ALIVE;
    const isAliveValue = metricsMap.get(isAliveKey) || 0;

    metricsMap.clear();
    metricsMap.set(isAliveKey, isAliveValue);
  }
  // End ExternalServicesStatusMetrics
}
