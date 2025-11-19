export function normalizeTranscript(text: string): string {
  if (!text) return "";

  let cleaned = text.replace(/\r/g, "").trim();
  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/^\s+|\s+$/g, "");

  try {
    const obj = JSON.parse(cleaned);
    if (typeof obj === "object") {
      return (
        "Окей, ось розшифрована розмова:\n\n" +
        (obj.dialogue ? `**Розмова**\n\n${obj.dialogue.trim()}\n\n` : "") +
        (obj.Резюме || obj.summary
          ? `**Резюме:**\n\n${(obj.Резюме || obj.summary).trim()}\n\n`
          : "") +
        (obj.Статус || obj.status
          ? `**Статус:**\n\n${(obj.Статус || obj.status).trim()}\n\n`
          : "") +
        (obj.Коментар || obj.comment
          ? `**Коментар:**\n\n${(obj.Коментар || obj.comment).trim()}\n`
          : "")
      ).trim();
    }
  } catch {}

  const hasResume = /\*\*\s*Резюме\s*[:：\-]/i.test(cleaned);
  const hasStatus = /\*\*\s*Статус\s*[:：\-]/i.test(cleaned);
  const hasComment = /\*\*\s*(Коментар|Комментарий|Comment)/i.test(cleaned);

  if (hasResume && hasStatus && hasComment)
    return "Окей, ось розшифрована розмова:\n\n" + cleaned.trim();

  return cleaned.trim();
}
