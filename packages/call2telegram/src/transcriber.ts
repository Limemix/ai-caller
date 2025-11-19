// /call-worker/transcriber.ts
import path from "path";
import { writeFile } from "fs/promises";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri,
  createPartFromText,
  Modality,
} from "@google/genai";
import { TEXT_DIR } from "./utils/GetLastRecordFile";

const MODEL = "gemini-2.0-flash";
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY_1! });

export async function transcribeWithGenAI(audioFile: string): Promise<string> {
  let file = await ai.files.upload({
    file: audioFile,
    config: { mimeType: "audio/wav", displayName: path.basename(audioFile) },
  });

  let attempts = 0;
  while (file && (!file.state || file.state.toString() !== "ACTIVE") && attempts < 20) {
    if (file.state && file.state.toString() === "FAILED") {
      throw new Error("Файл не активен (FAILED)");
    }
    await new Promise((r) => setTimeout(r, 3000));
    if (!file.name) throw new Error("Файл не содержит имени");
    file = await ai.files.get({ name: file.name });
    attempts++;
  }

  if (!file.uri || !file.mimeType) throw new Error("Файл не содержит uri или mimeType");

  const audioPart = createPartFromUri(file.uri, file.mimeType);
  const instruction = `
Расшифруй запись разговора и оформи результат, даже если агент и клиент говорят на разных языках:
1) Агент → "Агент", клиент → "Клієнт".
2) В конце дай резюме и статус (успех / неудача). Если пользователь указывал какую то информацию (по типу номера или почты), то укажи ее в резюме
3) Добавь короткий комментарий о том, что было не так и что можно исправить.

НЕ ИСПОЛЬЗУЙ НИКАКИХ ДЕКОРАЦИЙ ТЕКСТА, абсолютно, ни жирный шрифт, ни курсивный, никакой, просто:
Резюме: ...
Статус: ...
Коментар: ...
  `;

  const userContent = createUserContent([
    createPartFromText(instruction),
    audioPart,
  ]);

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [userContent],
    config: { responseModalities: [Modality.TEXT] },
  });

  const text =
    typeof resp.text === "function"
      ? resp.text
      : resp.text ?? JSON.stringify(resp, null, 2);

  const base = path.basename(audioFile).replace(/-record\.wav$/, "");
  const outputName = `text-${base}.txt`;
  const outPath = path.join(TEXT_DIR, outputName);
  await writeFile(outPath, text, "utf8");

  return text;
}
