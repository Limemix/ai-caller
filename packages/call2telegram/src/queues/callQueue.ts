import Queue from 'bull';

const KEEP_COMPLETED_JOBS = parseInt(process.env.KEEP_COMPLETED_JOBS || '1000', 10);
const KEEP_FAILED_JOBS = parseInt(process.env.KEEP_FAILED_JOBS || '500', 10);

const companyQueues = new Map<string, Queue>();
let addQueueToBoardFn: ((queue: Queue) => void) | null = null;

export function setAddQueueFunction(fn: (queue: Queue) => void) {
  addQueueToBoardFn = fn;
}

export function getCompanyQueue(companyId: string): Queue {
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

    queue.on('error', (error) => {
      console.error(`Queue error [${companyId}]:`, error);
    });

    queue.on('failed', (job, err) => {
      console.error(`Job ${job.id} failed [${companyId}]:`, err.message);
    });

    companyQueues.set(companyId, queue);

    if (addQueueToBoardFn) {
      addQueueToBoardFn(queue);
    }
  }
  return companyQueues.get(companyId)!;
}

export function getAllQueues(): Queue[] {
  return Array.from(companyQueues.values());
}

