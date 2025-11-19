export function getKyivTime(): Date {
  // Создаём дату на основе UTC
  const now = new Date();

  // Разница Киев (UTC+3)
  const offsetMs = 3 * 60 * 60 * 1000;

  // Возвращаем "сдвинутую" дату (но формат ISO всё равно будет с Z)
  return new Date(now.getTime() + offsetMs);
}