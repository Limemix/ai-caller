import { Job } from 'bull';
import { handleCall } from '../processes/handleCall';
import { getCompanyQueue } from './callQueue';
import { getKyivTime } from '../utils/date';
import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

const USE_MOCK = process.env.USE_MOCK_CALLS === 'true';
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '3', 10);
const WORKING_HOURS_START = parseInt(process.env.WORKING_HOURS_START || '8', 10);
const WORKING_HOURS_END = parseInt(process.env.WORKING_HOURS_END || '22', 10);

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
  }
  return redisClient;
}

function isAllowedTime(): boolean {
  if (USE_MOCK) {
    return true;
  }
  const now = getKyivTime();
  const hours = now.getHours();
  return hours >= WORKING_HOURS_START && hours < WORKING_HOURS_END;
}

function msUntilNextAllowedTime(): number {
  const now = getKyivTime();
  const next = new Date(now);

  if (now.getHours() >= WORKING_HOURS_END) {
    next.setDate(now.getDate() + 1);
  }
  next.setHours(WORKING_HOURS_START, 0, 0, 0);

  return next.getTime() - now.getTime();
}

const processedCompanies = new Set<string>();

export function setupCompanyProcessor(companyId: string) {
  if (processedCompanies.has(companyId)) {
    return;
  }

  const queue = getCompanyQueue(companyId);

  queue.process(MAX_CONCURRENT_CALLS, async (job: Job) => {
    const { phoneNumber, companyId: jobCompanyId, comment, userId } = job.data;

    if (!isAllowedTime()) {
      const waitMs = msUntilNextAllowedTime();
      throw new Error(`Outside working hours, retry in ${(waitMs / 1000 / 60).toFixed(0)}m`);
    }

    const client = await getRedisClient();
    await handleCall(
      { phoneNumber, companyId: jobCompanyId, comment, userId },
      client
    );
  });

  processedCompanies.add(companyId);
}

