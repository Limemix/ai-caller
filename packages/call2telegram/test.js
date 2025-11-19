import fs from "fs";
import { google } from "googleapis";

const CREDENTIALS_PATH = "./gen-lang-client-0960643963-333d6d312b22.json";
const SPREADSHEET_TITLE = "My Auto Sheet";
const DRIVE_FOLDER_ID = "1eVkOd2zjajziuJhjGBE5Dl7TibaJiJ36"; // 👈 твоя папка

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
  return auth;
}

async function findOrCreateSheet(auth) {
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.list({
    q: `name='${SPREADSHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet'`,
    fields: "files(id, name)",
  });

  if (res.data.files.length > 0) {
    console.log("✅ Таблица уже существует:", res.data.files[0].id);
    return res.data.files[0].id;
  }

  // создаем новую таблицу в твоей папке
  const file = await drive.files.create({
    requestBody: {
      name: SPREADSHEET_TITLE,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [DRIVE_FOLDER_ID],
    },
    fields: "id",
  });

  const spreadsheetId = file.data.id;
  console.log("🆕 Создана таблица:", spreadsheetId);

  // разрешаем доступ по ссылке
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: "reader",
      type: "anyone",
      allowFileDiscovery: false,
    },
  });

  console.log("🔗 Ссылка на таблицу:");
  console.log(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);

  return spreadsheetId;
}

async function appendData(auth, spreadsheetId, values) {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log("✅ Добавлены данные:", res.statusText);
}

// === Запуск ===
(async () => {
  try {
    const auth = await authorize();
    const spreadsheetId = await findOrCreateSheet(auth);
    await appendData(auth, spreadsheetId, [
      ["Имя", "Возраст", "Город"],
      ["Александр", 28, "Киев"],
      ["Мария", 25, "Одесса"],
    ]);
  } catch (err) {
    console.error("❌ Ошибка:", err);
  }
})();
