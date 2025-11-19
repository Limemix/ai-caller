import { readdir, stat } from "fs/promises";
import path from "path";

export const AUDIO_DIR = path.resolve("records/audio");
export const TEXT_DIR = path.resolve("records/text");

export async function getLastRecordFile(): Promise<string | null> {
  const files = await readdir(AUDIO_DIR);
  const recordFiles = files.filter(f => f.endsWith("-record.wav"));
  if (recordFiles.length === 0) return null;

  const fileStats = await Promise.all(
    recordFiles.map(async f => {
      const s = await stat(path.join(AUDIO_DIR, f));
      return { file: f, mtime: s.mtime };
    })
  );

  fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return path.join(AUDIO_DIR, fileStats[0].file);
}