import { readdir, unlink } from "fs/promises";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import path from "path";

const exec = promisify(execCb);

const AUDIO_DIR: string = path.resolve("records/audio");

export async function mergeRecords(): Promise<void> {
  const files: string[] = await readdir(AUDIO_DIR);

  // Ищем пары файлов: dump-....-dec.wav и dump-....-enc.wav
  const decFiles = files.filter(f => f.endsWith("-dec.wav"));
  const encFiles = files.filter(f => f.endsWith("-enc.wav"));

  // Создаём отображения по базовому имени
  const decMap = new Map<string, string>(
    decFiles.map(f => [f.replace("-dec.wav", ""), f])
  );
  const encMap = new Map<string, string>(
    encFiles.map(f => [f.replace("-enc.wav", ""), f])
  );

  for (const base of decMap.keys()) {
    if (!encMap.has(base)) continue;

    const decFile = decMap.get(base)!;
    const encFile = encMap.get(base)!;
    const outputFile = `${base}-record.wav`;

    console.log(`🔊 Соединяю: ${decFile} + ${encFile} → ${outputFile}`);

    try {
      await exec(
        `sox -M "${path.join(AUDIO_DIR, decFile)}" "${path.join(AUDIO_DIR, encFile)}" "${path.join(AUDIO_DIR, outputFile)}"`
      );

      // Удаляем исходники после объединения
      await unlink(path.join(AUDIO_DIR, decFile));
      await unlink(path.join(AUDIO_DIR, encFile));

      console.log(`✅ Готово: ${outputFile}`);
    } catch (err) {
      console.error(`❌ Ошибка при обработке ${base}:`, err);
    }
  }
}