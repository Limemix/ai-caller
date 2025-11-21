import Queue from 'bull';
import type { Queue as QueueType } from 'bull';
import { createClient } from 'redis';

const KEEP_COMPLETED_JOBS = parseInt(process.env.KEEP_COMPLETED_JOBS || '1000', 10);
const KEEP_FAILED_JOBS = parseInt(process.env.KEEP_FAILED_JOBS || '500', 10);

const companyQueues = new Map<string, QueueType>();
let addQueueToBoardFn: ((queue: QueueType) => void) | null = null;
let redisPublisher: ReturnType<typeof createClient> | null = null;

async function getPublisher() {
  if (!redisPublisher) {
    redisPublisher = createClient({ url: 'redis://localhost:6379' });
    await redisPublisher.connect();
  }
  return redisPublisher;
}

async function publishCallStatus(status: string, job: any, error?: string) {
  try {
    const publisher = await getPublisher();
    const statusData = {
      type: 'call-status',
      status,
      jobId: job.id,
      phoneNumber: job.data.phoneNumber,
      companyId: job.data.companyId,
      userId: job.data.userId,
      comment: job.data.comment,
      timestamp: new Date().toISOString(),
      ...(error && { error }),
    };
    
    await publisher.publish('call-status', JSON.stringify(statusData));
  } catch (err) {
    console.error('Failed to publish call status:', err);
  }
}

export function setAddQueueFunction(fn: (queue: QueueType) => void) {
  addQueueToBoardFn = fn;
}

export function getCompanyQueue(companyId: string): QueueType {
  if (!companyQueues.has(companyId)) {
    const queue = new Queue(`calls-${companyId}`, {
      redis: { host: 'localhost', port: 6379 },
      settings: {
        stalledInterval: 30000,
        maxStalledCount: 1,
        guardInterval: 5000,
        retryProcessDelay: 5000,
        backoffStrategies: {},
        drainDelay: 5,
        lockDuration: 300000,
      },
      defaultJobOptions: {
        attempts: 3,
        removeOnComplete: KEEP_COMPLETED_JOBS,
        removeOnFail: KEEP_FAILED_JOBS,
        backoff: {
          type: 'fixed',
          delay: 60000,
        },
      },
    });

    queue.on('waiting', async (jobId) => {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await publishCallStatus('queued', job);
        }
      } catch (err) {
        console.error('Error publishing waiting status:', err);
      }
    });

    queue.on('active', async (job) => {
      await publishCallStatus('active', job);
    });

    queue.on('completed', async (job) => {
      await publishCallStatus('completed', job);
    });

    queue.on('failed', async (job, err) => {
      await publishCallStatus('failed', job, err.message);
    });

    queue.on('delayed', async (jobId) => {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          await publishCallStatus('delayed', job);
        }
      } catch (err) {
        console.error('Error publishing delayed status:', err);
      }
    });

    queue.on('error', (error) => {
      console.error(`Queue error [${companyId}]:`, error);
    });

    companyQueues.set(companyId, queue);

    if (addQueueToBoardFn) {
      addQueueToBoardFn(queue);
    }
  }
  return companyQueues.get(companyId)!;
}

export function getAllQueues(): QueueType[] {
  return Array.from(companyQueues.values());
}

