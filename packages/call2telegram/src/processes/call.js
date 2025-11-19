import dotenv from "dotenv";
dotenv.config();

import { spawn } from "child_process";
import { GoogleGenAI, Modality } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
let micPaused = false;

function getRandomApiKey() {
  const keys = Object.entries(process.env)
    .filter(([key]) => key.startsWith("API_KEY_"))
    .map(([, value]) => value?.trim())
    .filter(Boolean);

  console.log(keys)

  if (keys.length === 0) {
    throw new Error("❌ Не найдено ни одного ключа API_KEY_");
  }

  const randomIndex = crypto.randomInt(0, keys.length);
  return keys[randomIndex];
}

const API_KEY = getRandomApiKey();

if (!API_KEY) {
  console.error("❌ Установите GEMINI_API_KEY в .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL = "gemini-2.5-flash-preview-native-audio-dialog";

const MIC_SAMPLE_RATE = 48000;
const BOT_SAMPLE_RATE = 24000;

// ---- Аргументы ----
const number = process.argv[2];
const companyId = process.argv[3];
let comment = process.argv[4]
if (!comment) {
  comment = ""
}
if (!number || !companyId) {
  console.error("❌ Укажите номер: node call.js 380111111111 12dd-f3fh-2rds...");
  process.exit(1);
}

// ---- baresip ----
const baresip = spawn("./src/processes/run_baresip.sh", [companyId]);
baresip.stdout.setEncoding("utf-8");

let botStarted = false;
let mic = null;
let speaker = null;
let session = null;

async function finishCall({ transcript = "", comment = "Виклик завершено" } = {}) {
  const callId = uuidv4();
  const result = {
    id: callId,
    date: new Date(),
    phone: number,
    companyId: companyId,
    userId: "system",
    transcript,
    comment,
  };

  try {
    console.log("✅ CallRecord сохранен:", result.id);
  } catch (err) {
    console.error("❌ Ошибка при сохранении CallRecord:", err);
  }

  if (process.send) {
    process.send({ type: "callResult", ...result });
  } else {
    console.log(JSON.stringify({ type: "callResult", ...result }));
  }

  try { hangup(); } catch { }
  try { mic?.kill("SIGINT"); } catch { }
  try { speaker?.kill("SIGINT"); } catch { }
  try { session?.close(); } catch { }
  try { baresip?.kill("SIGINT"); } catch { }

  process.exit(0);
}

function call(number) {
  baresip.stdin.write(`/dial sip:${number}@sip.zadarma.com\n`);
}

function hangup() {
  baresip.stdin.write(`/hangup\n`);
}

let playbackQueue = [];
let interrupted = false;
let isWriting = false;

async function stopBotSpeech() {
  if (!speaker) return;
  try {
    interrupted = true;
    playbackQueue = [];
    isWriting = false;

    speaker.stdin.end();
    speaker.kill("SIGTERM");
  } catch (err) {
    console.error("Ошибка при остановке речи бота:", err);
  }

  // Небольшая пауза, чтобы старый процесс точно завершился
  await new Promise(r => setTimeout(r, 150));

  speaker = spawn("pacat", [
    "-d", companyId + "_VAC2",
    "--format=s16le",
    `--rate=${BOT_SAMPLE_RATE}`,
    "--channels=1",
    "--latency-msec=20",
  ]);

  speaker.stderr.on("data", (d) => console.error("SPEAKER ERR:", d.toString()));
  speaker.stdin.on("error", (err) => {
    if (err.code !== "EPIPE") console.error("SPEAKER stdin error:", err);
  });

  interrupted = false;
}


async function safeWrite(pcmBuf) {
  if (interrupted || !speaker) return;
  playbackQueue.push(pcmBuf);
  if (isWriting) return;
  isWriting = true;

  while (playbackQueue.length > 0 && !interrupted && speaker) {
    const chunk = playbackQueue.shift();

    try {
      await new Promise((resolve, reject) => {
        speaker.stdin.write(chunk, (err) => {
          if (err && err.code === "EPIPE") return resolve(); // Просто выходим
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (err) {
      if (err.code !== "EPIPE") console.error("Ошибка записи:", err);
      break;
    }
  }

  isWriting = false;
}

// ---- запуск бота ----
async function startBot(agent, comment = "") {
  let accumulatedTranscript = "";

  const context = agent.bot_instructions || "";

  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: `
Ви — агент компанії, телефонуєте клієнту ${comment}, говорите перші (після слів "Алло, добрий день") - розказуєте про мету дзвінку.
ВАЖЛИВО, не використовуй і не вигадуй ніякого собі імені (ВИКЛЮЧНО якщо це вказано в інструкціях нижче)
Завдання: вести розмову та відповідати на питання, пропонувати прайс/зразки/подальші кроки, згідно з інструкцій.
Говоріть швидко і чітко.
Використовуйте українську мову для розмови, будьте ввічливими, короткими та по суті.
Якщо клієнт каже щось, чого немає в інструкціях - нічого не вигадуй, не погоджуйся, кажи "це потрібно дізнатися у менеджера"
Якщо чогось не вистачає — задайте уточнююче питання.
Якщо клієнт намагається говорити не по темі, кажи щоб не відходили від теми, не ведися на провокації.
Якщо вже кінець діалогу, завжди у кінці кажи "Гарного вам дня!", навіть якщо говоришь іншою мовою, завжди кажи так
Якщо клієнту незручно розмовляти - закінчуй розмову
Почніть діалог як агент

Інструкції:
${context}
    `,
    outputAudioTranscription: {},
  };
  //VirtualSink2
  speaker = spawn("pacat", [
    "-d", companyId + "_VAC2",
    "--format=s16le",
    `--rate=${BOT_SAMPLE_RATE}`,
    "--channels=1",
    "--latency-msec=20",
  ]);
  speaker.stderr.on("data", (d) => console.error("SPEAKER ERR:", d.toString()));
  speaker.stdin.on("error", (err) => {
    if (err.code !== "EPIPE") console.error("SPEAKER stdin error:", err);
  });

  session = await ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen: () => console.log("✅ Live session opened"),
      onmessage: async (message) => {
        if (message?.serverContent?.outputTranscription?.text) {
          accumulatedTranscript += message.serverContent.outputTranscription.text;
        }

        if (message?.serverContent?.interrupted) {
          console.log("⛔ Бот перебит пользователем — мгновенная остановка");
          await stopBotSpeech();
          return;
        }

        if (message?.data && !interrupted) {
          const pcmBuf = Buffer.from(message.data, "base64");
          safeWrite(pcmBuf);
        }

        if (message?.serverContent?.turnComplete) {
          console.log("⏹️ Бот закінчив говорити");
          interrupted = false;
          playbackQueue = [];

          if (accumulatedTranscript.toLowerCase().includes("гарного вам дня")) {
            hangup();
            await finishCall({
              transcript: accumulatedTranscript,
              comment: "Діалог завершено агентом",
            }).catch(console.error);
          }
          accumulatedTranscript = "";
        }
      },
    },
  });

  await session.sendRealtimeInput({ text: "Алло, добрий день" });

  let audioBuffer = Buffer.alloc(0);
  const BATCH_SIZE = 4800; // ~100ms при 48kHz (оптимальний баланс)

  function enqueueAudioFrame(frameBase64) {
    try {
      session.sendRealtimeInput({
        audio: { data: frameBase64, mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}` },
      });
    } catch { }
  }

  micPaused = true;
  setTimeout(() => {
    micPaused = false; // микрофон снова слушает
  }, 2000);

  mic = spawn("parec", [
    "-d", companyId + "_VAC1.monitor",
    "--format=s16le",
    `--rate=${MIC_SAMPLE_RATE}`,
    "--channels=1",
    "--latency-msec=20",
    "--process-time-msec=10",
  ]);

  mic.stdout.on("data", (chunk) => {
    if (micPaused) return;
    try {
      audioBuffer = Buffer.concat([audioBuffer, chunk]);
      
      if (audioBuffer.length >= BATCH_SIZE) {
        const base64 = audioBuffer.toString("base64");
        enqueueAudioFrame(base64);
        audioBuffer = Buffer.alloc(0);
      }
    } catch { }
  });

  mic.stderr.on("data", (d) => console.error("MIC ERR:", d.toString()));

  process.on("SIGINT", async () => {
    console.log("🛑 Остановка...");
    await finishCall({
      transcript: "ERR",
      comment: "Виклик перервано вручну",
    }).catch(console.error);
  });
}

// ---- baresip обработчики ----
(async () => {
  console.log("🚀 Запуск...");

  const agent = await prisma.agent.findUnique({ where: { companyId } });
  if (!agent) {
    console.error("❌ Агент не найден для companyId:", companyId);
    process.exit(1);
  }
  console.log("🤖 Найден агент:", agent.id);

  baresip.stdout.on("data", async (line) => {
    const out = line.trim();
    console.log("baresip:", out);

    if (!botStarted && out.includes("Call established")) {
      botStarted = true;
      console.log("📞 Вызов установлен — запускаем бота...");

      comment = comment ?? "Немає"
      await startBot(agent, comment).catch(console.error);
    }

    if (out.includes("480 Temporarily unavailable") || out.includes("486 Busy here")) {
      console.log("📴 Клиент завершил звонок — останавливаем процессы...");
      await finishCall({
        transcript: "CLIENT_BUSY",
        comment: "Клієнт не взяв слухавку",
      }).catch(console.error);
    }

    if (out.includes("session closed")) {
      console.log("📴 Клиент завершил звонок — останавливаем процессы...");
      await finishCall({
        transcript: "Ready",
        comment: "Клієнт завершив розмову",
      }).catch(console.error);
    }
  });

  baresip.stderr.on("data", (d) => {
    if (d.toString().includes("ERR")) console.error("baresip ERR:", d.toString().trim());
  });

  console.log(`📞 Звоним на номер: ${number}`);
  call(number);
})();