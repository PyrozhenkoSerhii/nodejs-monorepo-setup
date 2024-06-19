import { getRedisConfig } from "@shared/configs";
import { Logger } from "@shared/utils";

import { ServiceLocator } from "../essentials/locator.service";
import { AmqpQueueEntry } from "../essentials/rabbit.service";
import { ERedisKey } from "../essentials/redis.service";

export class RedisAmqpMessagesService {
  private static logger = new Logger("RedisAmqpMessagesService");

  public static async storeFallenAmqpQueueEntry(job: AmqpQueueEntry): Promise<void> {
    const key = `${ERedisKey.FALLEN_JOB}`;

    try {
      const existingJobs: AmqpQueueEntry[] = await ServiceLocator.getRedisServices().get(key, ERedisKey.FALLEN_JOB, true) || [];

      existingJobs.push(job);

      await ServiceLocator.getRedisServices().set(key, existingJobs, ERedisKey.FALLEN_JOB, true);
      await ServiceLocator.getRedisServices().setExpiration(key, getRedisConfig().expiration.amqpMessages, ERedisKey.FALLEN_JOB);
    } catch (error) {
      this.logger.error(`[storeFallenAmqpQueueEntry] Error storing job: ${error}`);
    }
  }

  /**
   * Get all fallen AMQP queue entries and clear the array
   */
  public static async getFallenAmqpQueueEntries(): Promise<AmqpQueueEntry[]> {
    const key = `${ERedisKey.FALLEN_JOB}`;

    try {
      const jobs: AmqpQueueEntry[] = await ServiceLocator.getRedisServices().get(key, ERedisKey.FALLEN_JOB, true) || [];

      await ServiceLocator.getRedisServices().set(key, [], ERedisKey.FALLEN_JOB, true);

      return jobs;
    } catch (error) {
      this.logger.error(`[getFallenAmqpQueueEntries] Error retrieving jobs: ${error}`);

      return [];
    }
  }
}
