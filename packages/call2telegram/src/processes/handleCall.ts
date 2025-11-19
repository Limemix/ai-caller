import { fork, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { getLastRecordFile } from "../utils/GetLastRecordFile";
import { prisma } from "../utils/prismaClient";
import { transcribeWithGenAI } from "../transcriber";
import { normalizeTranscript } from "../utils/transcriptUtils";
import { mergeRecords } from "./merge";
import { CallRecord } from "../types/types"
import { mockCall } from "./mockCall";

const USE_MOCK = process.env.USE_MOCK_CALLS === 'true';

export async function handleCall(data: any, client: any): Promise<void> {
    if (USE_MOCK) {
        const parsed = await mockCall(data.phoneNumber, data.companyId, data.comment);
        await processCallResult(parsed, data, client);
        return;
    }

    return new Promise((resolve, reject) => {
        const callProcess: ChildProcess = fork("./src/processes/call.js", [data.phoneNumber, data.companyId, data.comment], {
            env: { ...process.env, COMPANY_ID: data.companyId, USER_ID: data.userId.toString() },
        });

        let resolved = false;

        callProcess.on("message", async (parsed: any) => {
        if (parsed?.type !== "callResult") return;
        try {
            await processCallResult(parsed, data, client);

            if (!resolved) {
                resolved = true;
                resolve();
            }

        } catch (err) {
            console.error("Call processing error:", err);
            if (!resolved) {
                resolved = true;
                reject(err);
            }
        }
    });

    callProcess.on("exit", (code) => {
        if (code !== 0 && !resolved) {
            resolved = true;
            reject(new Error(`Process exited with code ${code}`));
        }
    });

    callProcess.on("error", (err) => {
        if (!resolved) {
            resolved = true;
            reject(err);
        }
    });
    });
}

async function processCallResult(parsed: any, data: any, client: any) {
    if (parsed.transcript === "CLIENT_BUSY") {
                const result: CallRecord = {
                    id: uuidv4(),
                    date: new Date(),
                    phone: data.phoneNumber,
                    companyId: data.companyId,
                    userId: data.userId.toString(),
                    transcript: "Статус: Клієнт не взяв слухавку",
                    comment: parsed.comment || "Клієнт не взяв слухавку",
                };

                await prisma.callRecord.create({ data: result });

                const url =
                    data.companyId === "6b71cb11-caed-41d2-9737-167b73eaf2d9"
                        ? process.env.GSHEET_WEBHOOK_URL_ANTON!
                        : process.env.GSHEET_WEBHOOK_URL!;

                const dataToSend = {
                    date: new Date(),
                    phone: data.phoneNumber,
                    companyId: data.companyId,
                    userId: data.userId.toString(),
                    comment: data.comment,
                    transcript: "Статус: Клієнт не взяв слухавку",
                };

                try {
                    await Promise.race([
                        fetch(url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(dataToSend),
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Webhook timeout")), 5000))
                    ]);
                } catch (err) {
                    console.error("Webhook error:", err);
                }

                client.publish("calls-results", JSON.stringify(result));


            } else {
                let transcript = parsed.transcript || "";
                let audioUrl: string | undefined = parsed.audioUrl;

                if (!USE_MOCK) {
                    await mergeRecords();
                    const audioFile = await getLastRecordFile();

                    if (audioFile) {
                        transcript = await transcribeWithGenAI(audioFile);
                        audioUrl = audioFile;
                    }
                }

                const result: CallRecord = {
                    id: uuidv4(),
                    date: new Date(),
                    phone: data.phoneNumber,
                    companyId: data.companyId,
                    userId: data.userId.toString(),
                    transcript,
                    audioUrl,
                    comment: parsed.comment || "Вызов завершен",
                };

                await prisma.callRecord.create({ data: result });

                const normalized = normalizeTranscript(result.transcript);
                const dataToSend = {
                    date: new Date(),
                    phone: data.phoneNumber,
                    companyId: data.companyId,
                    userId: data.userId.toString(),
                    comment: data.comment,
                    transcript: normalized,
                };

                const url =
                    data.companyId === "6b71cb11-caed-41d2-9737-167b73eaf2d9"
                        ? process.env.GSHEET_WEBHOOK_URL_ANTON!
                        : process.env.GSHEET_WEBHOOK_URL!;

                try {
                    await Promise.race([
                        fetch(url, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(dataToSend),
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("Webhook timeout")), 5000))
                    ]);
                } catch (err) {
                    console.error("Webhook error:", err);
                }

                client.publish("calls-results", JSON.stringify(result));
            }
}
