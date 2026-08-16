/**
 * Страховка от затирания clientsTable приложением AmneziaVPN.
 *
 * Приложение при переподключении/перезагрузке сервера пересобирает clientsTable
 * из awg0.conf: остаются только clientId и дефолтные имена «Client N», а имена,
 * даты создания и last_config, которые ведёт панель, пропадают.
 *
 * Панель держит свою копию этих полей в DATA_DIR (том /data переживает
 * пересоздание контейнера) и возвращает их на место при следующем чтении.
 */
import fs from "fs";
import path from "path";

/** Поля userData, которые ведёт панель и которые нельзя терять. */
export const META_FIELDS = ["clientName", "creationDate", "last_config", "allowedIps"];

/** «Client 17» — дефолтное имя от приложения, оно не ценнее сохранённого. */
export function isPlaceholderName(name) {
  return /^Client\s*\d+$/i.test(String(name || "").trim());
}

function isMeaningful(field, value) {
  if (value == null || value === "") return false;
  return field === "clientName" ? !isPlaceholderName(value) : true;
}

function metaFile(dataDir, profileId) {
  const safe = String(profileId || "default").replace(/[^\w.-]/g, "_");
  return path.join(dataDir, "clients-meta", `${safe}.json`);
}

export function readClientsMeta(dataDir, profileId) {
  try {
    const data = JSON.parse(fs.readFileSync(metaFile(dataDir, profileId), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function writeClientsMeta(dataDir, profileId, meta) {
  const file = metaFile(dataDir, profileId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Возвращает клиентов с восстановленными полями и число восстановленных значений.
 * Заодно обновляет снимок метаданных теми значениями, что сейчас на сервере;
 * metaChanged=false — снимок писать не нужно (панель читает состояние часто).
 */
export function healClientsMeta(clients, meta) {
  let restored = 0;
  const before = JSON.stringify(meta);
  const nextMeta = { ...meta };
  const healed = clients.map((row) => {
    const id = row?.clientId;
    if (!id) return row;
    const userData = { ...(row.userData || {}) };
    const saved = nextMeta[id] || {};
    for (const field of META_FIELDS) {
      if (!isMeaningful(field, userData[field]) && isMeaningful(field, saved[field])) {
        userData[field] = saved[field];
        restored++;
      }
    }
    const keep = {};
    for (const field of META_FIELDS) {
      if (isMeaningful(field, userData[field])) keep[field] = userData[field];
    }
    if (Object.keys(keep).length) nextMeta[id] = keep;
    return { ...row, userData };
  });
  return { clients: healed, restored, meta: nextMeta, metaChanged: JSON.stringify(nextMeta) !== before };
}
