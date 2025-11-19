import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { setAddQueueFunction } from './queues/callQueue';
import type Queue from 'bull';

const app = express();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const { addQueue } = createBullBoard({
  queues: [],
  serverAdapter,
});

setAddQueueFunction((queue: Queue) => {
  addQueue(new BullAdapter(queue));
});

app.use('/admin/queues', serverAdapter.getRouter());

const PORT = process.env.BULL_BOARD_PORT || 3001;
app.listen(PORT, () => {
  console.log(`📊 Bull Board доступен на http://localhost:${PORT}/admin/queues`);
});

