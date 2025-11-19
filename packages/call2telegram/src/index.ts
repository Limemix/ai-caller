import { createClient } from "redis";
import dotenv from "dotenv";
import { getCompanyQueue } from "./queues/callQueue";
import { setupCompanyProcessor } from "./queues/callProcessor";
import { getKyivTime } from "./utils/date";

dotenv.config();

await import("./server");

const USE_MOCK = process.env.USE_MOCK_CALLS === 'true';
const WORKING_HOURS_START = parseInt(process.env.WORKING_HOURS_START || '8', 10);
const WORKING_HOURS_END = parseInt(process.env.WORKING_HOURS_END || '22', 10);

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

async function main() {
  const client = createClient({ url: "redis://localhost:6379" });
  await client.connect();

  const subscriber = client.duplicate();
  await subscriber.connect();

  await subscriber.subscribe("calls", async (message: string) => {
    const data = JSON.parse(message);
    const { companyId, phoneNumber, comment, userId } = data;

    setupCompanyProcessor(companyId);
    await new Promise(resolve => setTimeout(resolve, 100));

    const queue = getCompanyQueue(companyId);
    const allowedTime = isAllowedTime();
    const delayMs = allowedTime ? 0 : msUntilNextAllowedTime();

    const job = await queue.add(
      { phoneNumber, companyId, comment, userId },
      {
        priority: data.priority || 0,
        delay: delayMs,
        jobId: `${companyId}-${Date.now()}-${Math.random()}`,
      }
    );

    console.log(
      `Call ${allowedTime ? 'queued' : 'delayed'} [${companyId}]: ${phoneNumber}`,
      delayMs > 0 ? `(~${(delayMs / 1000 / 60).toFixed(0)}m)` : ''
    );
  });

  console.log("Call handler ready");
  console.log(`Config: mock=${USE_MOCK}, concurrent=${process.env.MAX_CONCURRENT_CALLS || '3'}, hours=${WORKING_HOURS_START}-${WORKING_HOURS_END}`);
}

main().catch(console.error);
