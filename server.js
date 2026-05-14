import express from "express";
import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3980);
const PROFILE_COOKIE = "amnezia_prof";
const SCHEDULER_MS = Number(process.env.SCHEDULE_DISCONNECT_MS || 60_000);

function parseProfilesFromEnv() {
  const raw = process.env.AWG_PROFILES?.trim();
  const fallback = () => [
    {
      id: "awg",
      label: process.env.AWG_PROFILE_LABEL || "AmneziaWG",
      container: process.env.AWG_CONTAINER || "amnezia-awg2",
      confPath: process.env.AWG_CONF_PATH || "/opt/amnezia/awg/awg0.conf",
      clientsPath: process.env.AWG_CLIENTS_PATH || "/opt/amnezia/awg/clientsTable",
      iface: process.env.AWG_IFACE || "awg0",
      wgBinary: process.env.AWG_BINARY || "awg",
      pskPath: process.env.AWG_PSK_PATH || "/opt/amnezia/awg/wireguard_psk.key",
    },
  ];
  if (!raw) return fallback();
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return fallback();
    return arr
      .map((row, i) => ({
        id: String(row.id ?? `p${i}`),
        label: String(row.label ?? row.id ?? `Профиль ${i + 1}`),
        container: String(row.container ?? ""),
        confPath: String(row.confPath ?? row.conf ?? "/opt/amnezia/awg/awg0.conf"),
        clientsPath: String(row.clientsPath ?? row.clients ?? "/opt/amnezia/awg/clientsTable"),
        iface: String(row.iface ?? row.IFACE ?? "awg0"),
        wgBinary: String(row.wgBinary ?? row.binary ?? "awg"),
        pskPath: String(row.pskPath ?? row.psk ?? "/opt/amnezia/awg/wireguard_psk.key"),
      }))
      .filter((p) => p.container);
  } catch {
    console.warn("AWG_PROFILES: невалидный JSON, используется профиль по умолчанию.");
    return fallback();
  }
}

const PROFILES = parseProfilesFromEnv();
if (!PROFILES.length) {
  console.error("Нет ни одного профиля AWG: укажите container в AWG_PROFILES или переменные по умолчанию.");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR || "/data";
const PW_FILE = path.join(DATA_DIR, "password.hash");
const SECRET_FILE = path.join(DATA_DIR, "session.secret");

const SESSION_COOKIE = "amnezia_sess";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

let passwordHashStored = "";
let sessionSecret = "";

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  let hash;
  try {
    hash = crypto.scryptSync(password, salt, 64);
  } catch {
    return false;
  }
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

function loadOrCreateSessionSecret() {
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) {
    sessionSecret = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (sessionSecret.length < 32) {
      throw new Error("session.secret слишком короткий — удалите файл для пересоздания");
    }
    return;
  }
  sessionSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
}

function rotateSessionSecret() {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SECRET_FILE, `${sessionSecret}\n`, { mode: 0o600 });
}

function bootstrapPassword() {
  ensureDataDir();
  if (fs.existsSync(PW_FILE)) {
    passwordHashStored = fs.readFileSync(PW_FILE, "utf8").trim();
    if (!passwordHashStored) throw new Error("password.hash пуст");
    return;
  }
  const bootstrap = process.env.ADMIN_PASSWORD || "";
  if (bootstrap) {
    passwordHashStored = hashPassword(bootstrap);
    fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
    console.warn(
      "Пароль сохранён в /data/password.hash. Уберите ADMIN_PASSWORD из окружения после первого старта."
    );
    return;
  }
  const legacyToken = process.env.ADMIN_TOKEN || "";
  if (legacyToken) {
    passwordHashStored = hashPassword(legacyToken);
    fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
    console.warn(
      "Миграция: пароль взяли из ADMIN_TOKEN и сохранили в /data/password.hash. Удалите ADMIN_TOKEN из окружения."
    );
    return;
  }
  const allowDefault =
    process.env.ALLOW_DEFAULT_PASSWORD === "1" ||
    process.env.ALLOW_DEFAULT_PASSWORD === "true";
  const docPass = process.env.DEFAULT_ADMIN_PASSWORD || "AmneziaAdmin!ChangeMe";
  if (allowDefault) {
    passwordHashStored = hashPassword(docPass);
    fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
    console.warn(
      "Включён пароль по умолчанию из документации (README). Смените его в панели и отключите ALLOW_DEFAULT_PASSWORD."
    );
    return;
  }
  console.error(
    "Нет пароля: задайте ADMIN_PASSWORD при первом запуске, см. README, или ALLOW_DEFAULT_PASSWORD=1 только для теста."
  );
  process.exit(1);
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(token) {
  if (!token || !sessionSecret) return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try {
    expected = crypto.createHmac("sha256", sessionSecret).update(body).digest("base64url");
  } catch {
    return null;
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

function getSessionToken(req) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const p = part.trim();
    if (p.startsWith(`${SESSION_COOKIE}=`)) {
      return decodeURIComponent(p.slice(SESSION_COOKIE.length + 1));
    }
  }
  return null;
}

function getProfileCookie(req) {
  const raw = req.headers.cookie || "";
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const s = part.trim();
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    const k = decodeURIComponent(s.slice(0, eq).trim());
    if (k !== PROFILE_COOKIE) continue;
    return decodeURIComponent(s.slice(eq + 1).trim());
  }
  return null;
}

function cookieSecureFlag() {
  return process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true";
}

function setSessionCookie(res, token, maxAgeSec) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function clearSessionCookie(res) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function setProfileCookie(res, profileId) {
  const sec = cookieSecureFlag();
  res.setHeader(
    "Set-Cookie",
    `${PROFILE_COOKIE}=${encodeURIComponent(profileId)}; Max-Age=${31536000}; Path=/; SameSite=Lax${sec ? "; Secure" : ""}`
  );
}

function requireAuth(req, res, next) {
  const sess = readSession(getSessionToken(req));
  if (!sess) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function execDocker(args, stdin = null) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(err.trim() || out.trim() || `exit ${code}`));
    });
    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

function createRuntime(profile) {
  const container = profile.container;
  const confPath = profile.confPath;
  const clientsPath = profile.clientsPath;
  const iface = profile.iface;
  const wgBinary = profile.wgBinary;
  const pskPath = profile.pskPath;

  async function dockerExec(cmd) {
    const { stdout, stderr } = await execDocker(["exec", container, "sh", "-c", cmd]);
    return stdout + stderr;
  }

  async function dockerReadFile(remotePath) {
    const { stdout } = await execDocker(["exec", container, "cat", remotePath]);
    return stdout;
  }

  async function dockerWriteFile(remotePath, content) {
    await execDocker(
      [
        "exec",
        "-i",
        container,
        "sh",
        "-c",
        `cat > '${remotePath}.tmp' && mv '${remotePath}.tmp' '${remotePath}'`,
      ],
      content
    );
  }

  async function backupRemoteFiles() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await dockerExec(`cp '${confPath}' '${confPath}.bak-admin-${stamp}' 2>/dev/null || true`);
    await dockerExec(
      `cp '${clientsPath}' '${clientsPath}.bak-admin-${stamp}' 2>/dev/null || true`
    );
  }

  async function applySyncconf() {
    await dockerExec(
      `wg-quick strip '${confPath}' > /tmp/wg-admin-strip.conf && ${wgBinary} syncconf ${iface} /tmp/wg-admin-strip.conf`
    );
  }

  async function loadState() {
    const [confText, tableText] = await Promise.all([
      dockerReadFile(confPath),
      dockerReadFile(clientsPath),
    ]);
    const conf = splitAwgConf(confText);
    const clients = parseClientsTable(tableText);
    const peerByKey = new Map(conf.peers.map((p) => [p.publicKey, p]));
    return { confText, conf, clients, peerByKey };
  }

  async function inferPskFromConf(conf) {
    if (conf.peers.length) return conf.peers[0].presharedKey;
    try {
      const text = await dockerReadFile(pskPath);
      return text.trim();
    } catch {
      return null;
    }
  }

  return {
    profile,
    dockerExec,
    dockerReadFile,
    dockerWriteFile,
    backupRemoteFiles,
    applySyncconf,
    loadState,
    inferPskFromConf,
    confPath,
    clientsPath,
  };
}

function runtimeForRequest(req) {
  const wanted = getProfileCookie(req);
  const profile = PROFILES.find((p) => p.id === wanted) || PROFILES[0];
  return createRuntime(profile);
}

function splitAwgConf(text) {
  const t = text.replace(/\r\n/g, "\n");
  const parts = t.split(/(?=^\[Peer\])/m);
  const head = parts[0].trimEnd();
  const peers = parts.slice(1).map(parsePeerBlock).filter((p) => p.publicKey);
  return { head, peers };
}

function parsePeerBlock(block) {
  const lineMap = (key) => {
    const m = block.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const publicKey = lineMap("PublicKey");
  const presharedKey = lineMap("PresharedKey");
  const allowedIPs = lineMap("AllowedIPs");
  const raw = block.trimEnd();
  return { raw, publicKey, presharedKey, allowedIPs };
}

function serializeAwgConf(head, peers) {
  const body = peers.map((p) => p.raw.trim()).join("\n\n");
  return (body ? `${head}\n\n${body}\n` : `${head}\n`).replace(/\n+$/, "\n");
}

function parseClientsTable(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("clientsTable is not an array");
  return data;
}

function stringifyClientsTable(rows) {
  return `${JSON.stringify(rows, null, 4)}\n`;
}

async function disableClient(rt, clientId, ts) {
  await rt.backupRemoteFiles();
  const { conf, clients } = await rt.loadState();
  const peer = conf.peers.find((p) => p.publicKey === clientId);
  if (!peer) {
    throw new Error("Peer not in config (already disabled?)");
  }
  const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
  const nextConfText = serializeAwgConf(conf.head, nextPeers);
  const idx = clients.findIndex((c) => c.clientId === clientId);
  if (idx === -1) throw new Error("Client not in clientsTable");
  const ud = { ...(clients[idx].userData || {}) };
  ud.disabled = true;
  ud.disabledAt = ts;
  ud.lastDisconnectedAt = ts;
  delete ud.scheduledTunnelDisconnectAt;
  ud.preservedPresharedKey = peer.presharedKey || ud.preservedPresharedKey;
  ud.preservedAllowedIPs = peer.allowedIPs || ud.preservedAllowedIPs;
  clients[idx] = { ...clients[idx], userData: ud };
  await rt.dockerWriteFile(rt.confPath, nextConfText);
  await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
  await rt.applySyncconf();
}

async function processScheduledDisconnects(rt) {
  const now = Date.now();
  const { clients, peerByKey } = await rt.loadState();
  const due = [];
  for (const c of clients) {
    const ud = c.userData || {};
    const iso = ud.scheduledTunnelDisconnectAt;
    if (!iso || !peerByKey.get(c.clientId)) continue;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t > now) continue;
    due.push({ clientId: c.clientId, ts: new Date(iso).toISOString() });
  }
  if (!due.length) return;
  await rt.backupRemoteFiles();
  for (const { clientId, ts } of due) {
    try {
      await disableClient(rt, clientId, ts);
    } catch (e) {
      console.error(`scheduled off ${clientId} [${rt.profile.id}]:`, e);
    }
  }
}

async function processAllScheduledDisconnects() {
  for (const profile of PROFILES) {
    await processScheduledDisconnects(createRuntime(profile));
  }
}

/** ISO string; пустое значение → текущий момент */
function normalizeDisconnectedAtOptional(raw) {
  if (raw == null || raw === "") return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата disconnectedAt");
  }
  return d.toISOString();
}

function requireDisconnectedAt(raw) {
  if (raw == null || raw === "") {
    throw new Error("Укажите дату отключения");
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата");
  }
  return d.toISOString();
}

/** Пояс для строки «Сервер»: переменная TZ контейнера или значение из Intl (часто UTC в Docker). Без подмены под пояс браузера. */
function resolveServerClockTimeZone() {
  const tzEnv = process.env.TZ?.trim();
  if (tzEnv) return tzEnv;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Смещение от UTC в минутах для IANA-пояса в данный момент (через GMT± из Intl). */
function offsetMinutesFromUtc(timeZone, date) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const parts = dtf.formatToParts(date);
    let raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
    raw = raw.replace(/\u2212/g, "-").trim();
    let m = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i);
    if (!m) {
      m = raw.match(/^([+-])(\d{2}):(\d{2})$/);
      if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const h = parseInt(m[2], 10);
        const min = parseInt(m[3], 10);
        return sign * (h * 60 + min);
      }
      return 0;
    }
    const sign = m[1] === "-" ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (h * 60 + min);
  } catch {
    return 0;
  }
}

function buildZoneCompare(serverTz, browserTz, now) {
  if (!browserTz) {
    return { sameZone: null, hint: "", diffMinutes: null };
  }
  if (browserTz === serverTz) {
    return {
      sameZone: true,
      hint: "Пояс браузера совпадает с поясом строки «Сервер» — часы совпадут.",
      diffMinutes: 0,
    };
  }
  const so = offsetMinutesFromUtc(serverTz, now);
  const bo = offsetMinutesFromUtc(browserTz, now);
  const diffMin = bo - so;
  const abs = Math.abs(diffMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const ahead = diffMin > 0;
  const hint = ahead
    ? `Ваше место (${browserTz}): на ${h} ч ${m} мин «впереди» строки «Сервер» (${serverTz}) при одном UTC.`
    : `Ваше место (${browserTz}): на ${h} ч ${m} мин «позже» пояса сервера (${serverTz}).`;
  return { sameZone: false, hint, diffMinutes: diffMin };
}

function sshpassBinaryPath() {
  for (const p of ["/usr/bin/sshpass", "/usr/local/bin/sshpass"]) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function hostTimeSyncConfigured() {
  if (process.env.TIME_SYNC_DISABLED === "1" || process.env.TIME_SYNC_DISABLED === "true") {
    return false;
  }
  return !!sshpassBinaryPath();
}

function sshRootRun(password, host, remoteCmd) {
  const bin = sshpassBinaryPath();
  if (!bin) {
    return Promise.reject(new Error("sshpass не установлен"));
  }
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      password,
      "ssh",
      "-oBatchMode=yes",
      "-oStrictHostKeyChecking=no",
      "-oUserKnownHostsFile=/dev/null",
      "-oConnectTimeout=15",
      "-oPreferredAuthentications=password",
      "-oPubkeyAuthentication=no",
      `root@${host}`,
      remoteCmd,
    ];
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || out.trim() || `ssh код ${code}`));
    });
  });
}

ensureDataDir();
loadOrCreateSessionSecret();
bootstrapPassword();

const app = express();
app.use(express.json({ limit: "512kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  if (!readSession(getSessionToken(req))) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/server-time", requireAuth, (req, res) => {
  const now = new Date();
  const timeZone = resolveServerClockTimeZone();
  let formatted;
  try {
    formatted = now.toLocaleString("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone,
    });
  } catch {
    formatted = now.toLocaleString("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  }
  const browserTz =
    typeof req.query.browserTz === "string" ? req.query.browserTz.trim() : "";
  const zoneCompare = buildZoneCompare(timeZone, browserTz, now);
  res.json({
    iso: now.toISOString(),
    formatted,
    timeZone,
    browserTimeZone: browserTz || null,
    zoneSame: zoneCompare.sameZone,
    zoneCompareHint: zoneCompare.hint,
    zoneDiffMinutes: zoneCompare.diffMinutes ?? null,
  });
});

app.get("/api/time-sync-capabilities", requireAuth, (_req, res) => {
  res.json({
    hostTimeSync: hostTimeSyncConfigured(),
    sshHost: process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1",
    serverClockTimeZone: resolveServerClockTimeZone(),
  });
});

app.post("/api/sync-host-time", requireAuth, async (req, res) => {
  if (!hostTimeSyncConfigured()) {
    return res.status(503).json({
      error:
        "Синхронизация времени хоста недоступна (нет sshpass или TIME_SYNC_DISABLED=1).",
    });
  }
  const pw = req.body?.rootPassword;
  const unixMsRaw = req.body?.unixMs;
  const unixMs =
    typeof unixMsRaw === "number" && Number.isFinite(unixMsRaw) ? unixMsRaw : Date.now();
  if (typeof pw !== "string" || !pw) {
    return res.status(400).json({ error: "Укажите пароль root VPS" });
  }
  const unixSec = Math.floor(unixMs / 1000);
  if (!Number.isFinite(unixSec)) {
    return res.status(400).json({ error: "Некорректное время" });
  }
  const host = process.env.TIME_SYNC_SSH_HOST?.trim() || "172.17.0.1";
  const remoteCmd = `bash -lc 'date -u --set=@${unixSec} 2>/dev/null || date -s @${unixSec}; (command -v hwclock >/dev/null && hwclock -w --utc) || true; date -u +%Y-%m-%dT%H:%M:%SZ'`;
  try {
    const confirmed = await sshRootRun(pw, host, remoteCmd);
    res.json({ ok: true, utc: confirmed });
  } catch {
    console.warn("sync-host-time: ssh не выполнен");
    res.status(400).json({
      error:
        "Не удалось выставить время по SSH. Проверьте пароль root, вход root по паролю на хосте и переменную TIME_SYNC_SSH_HOST (часто 172.17.0.1 с контейнера).",
    });
  }
});

app.post("/api/login", (req, res) => {
  const pw = req.body?.password;
  if (typeof pw !== "string" || !pw) {
    res.status(400).json({ error: "password required" });
    return;
  }
  if (!verifyPassword(pw, passwordHashStored)) {
    res.status(401).json({ error: "Неверный пароль" });
    return;
  }
  const token = signSession({ exp: Date.now() + SESSION_MS });
  setSessionCookie(res, token, Math.floor(SESSION_MS / 1000));
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/change-password", requireAuth, (req, res) => {
  const cur = req.body?.currentPassword;
  const neu = req.body?.newPassword;
  if (typeof cur !== "string" || typeof neu !== "string") {
    res.status(400).json({ error: "currentPassword и newPassword обязательны" });
    return;
  }
  if (neu.length < 8) {
    res.status(400).json({ error: "Новый пароль — не короче 8 символов" });
    return;
  }
  if (!verifyPassword(cur, passwordHashStored)) {
    res.status(401).json({ error: "Текущий пароль неверный" });
    return;
  }
  passwordHashStored = hashPassword(neu);
  fs.writeFileSync(PW_FILE, `${passwordHashStored}\n`, { mode: 0o600 });
  rotateSessionSecret();
  clearSessionCookie(res);
  res.json({ ok: true, message: "Пароль изменён. Войдите снова." });
});

app.get("/api/protocols", requireAuth, (req, res) => {
  const rt = runtimeForRequest(req);
  res.json({
    currentId: rt.profile.id,
    currentLabel: rt.profile.label,
    profiles: PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      container: p.container,
    })),
  });
});

app.post("/api/protocol", requireAuth, (req, res) => {
  const id = req.body?.profileId;
  if (typeof id !== "string" || !PROFILES.some((p) => p.id === id)) {
    res.status(400).json({ error: "Неизвестный profileId" });
    return;
  }
  setProfileCookie(res, id);
  res.json({ ok: true });
});

app.get("/api/clients", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  try {
    let wgShow = "";
    try {
      wgShow = await rt.dockerExec(`${rt.profile.wgBinary} show ${rt.profile.iface}`);
    } catch {
      wgShow = "";
    }
    const { conf, clients, peerByKey } = await rt.loadState();
    const rows = clients.map((c) => {
      const id = c.clientId;
      const peer = peerByKey.get(id);
      const ud = c.userData || {};
      const activeInConf = !!peer;
      return {
        clientId: id,
        name: ud.clientName || `${id.slice(0, 10)}…`,
        allowedIps: peer?.allowedIPs || ud.allowedIps || ud.preservedAllowedIPs || null,
        activeInConf,
        disabled: !activeInConf,
        disabledAt: ud.disabledAt || null,
        lastDisconnectedAt: ud.lastDisconnectedAt || null,
        scheduledTunnelDisconnectAt: ud.scheduledTunnelDisconnectAt || null,
        creationDate: ud.creationDate || null,
        latestHandshake: ud.latestHandshake || null,
        dataReceived: ud.dataReceived || null,
        dataSent: ud.dataSent || null,
      };
    });
    res.json({
      profileId: rt.profile.id,
      profileLabel: rt.profile.label,
      container: rt.profile.container,
      protocol: "AmneziaWG",
      peerCount: conf.peers.length,
      clients: rows,
      wgShow,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/disable", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let ts;
  try {
    ts = normalizeDisconnectedAtOptional(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  try {
    await disableClient(rt, clientId, ts);
    res.json({ ok: true });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("already disabled") || msg.includes("Peer not in config")) {
      return res.status(404).json({ error: msg });
    }
    console.error(e);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/clients/enable", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await rt.backupRemoteFiles();
    const { conf, clients } = await rt.loadState();
    const existing = conf.peers.find((p) => p.publicKey === clientId);
    if (existing) {
      return res.status(409).json({ error: "Peer already enabled" });
    }
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const ud = { ...(clients[idx].userData || {}) };
    const psk =
      ud.preservedPresharedKey ||
      conf.peers[0]?.presharedKey ||
      (await rt.inferPskFromConf(conf));
    const ips = ud.preservedAllowedIPs || ud.allowedIps;
    if (!psk || !ips) {
      return res.status(400).json({
        error:
          "Missing preserved keys — cannot enable (restore from backup or re-import in Amnezia)",
      });
    }
    const raw = `[Peer]
PublicKey = ${clientId}
PresharedKey = ${psk}
AllowedIPs = ${ips}`;
    const peer = parsePeerBlock(`${raw}\n`);
    const nextPeers = [...conf.peers, peer];
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    delete ud.disabled;
    delete ud.disabledAt;
    delete ud.scheduledTunnelDisconnectAt;
    delete ud.preservedPresharedKey;
    delete ud.preservedAllowedIPs;
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.confPath, nextConfText);
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    await rt.applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/disconnect-date", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let iso;
  try {
    iso = requireDisconnectedAt(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  const scheduleTunnelDisconnect = Boolean(req.body?.scheduleTunnelDisconnect);
  try {
    const { clients, peerByKey } = await rt.loadState();
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const peer = peerByKey.get(clientId);
    const ud = { ...(clients[idx].userData || {}) };
    if (scheduleTunnelDisconnect) {
      if (!peer) {
        return res.status(400).json({
          error: "Клиент не в туннеле — отложенное отключение недоступно",
        });
      }
      ud.scheduledTunnelDisconnectAt = iso;
    } else {
      delete ud.scheduledTunnelDisconnectAt;
      ud.lastDisconnectedAt = iso;
      if (!peer) {
        ud.disabledAt = iso;
      }
    }
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/rename", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  const rawName = req.body?.name ?? req.body?.clientName;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  if (typeof rawName !== "string") {
    return res.status(400).json({ error: "name required" });
  }
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return res.status(400).json({ error: "Имя не может быть пустым" });
  if (name.length > 200) {
    return res.status(400).json({ error: "Имя не длиннее 200 символов" });
  }
  try {
    const { clients } = await rt.loadState();
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const ud = { ...(clients[idx].userData || {}), clientName: name };
    clients[idx] = { ...clients[idx], userData: ud };
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/delete", requireAuth, async (req, res) => {
  const rt = runtimeForRequest(req);
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await rt.backupRemoteFiles();
    const { conf, clients } = await rt.loadState();
    const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
    const nextClients = clients.filter((c) => c.clientId !== clientId);
    if (nextClients.length === clients.length) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    await rt.dockerWriteFile(rt.confPath, nextConfText);
    await rt.dockerWriteFile(rt.clientsPath, stringifyClientsTable(nextClients));
    await rt.applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const pub = path.join(__dirname, "public");
if (fs.existsSync(pub)) {
  app.use(
    express.static(pub, {
      setHeaders(res, filePath) {
        const lower = filePath.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
}

app.use((_req, res) => {
  res.status(404).send("Not found");
});

app.listen(PORT, "0.0.0.0", () => {
  const summary = PROFILES.map((p) => `${p.label}→${p.container}`).join("; ");
  console.log(`amnezia-admin on :${PORT} · ${summary} · data:${DATA_DIR}`);
});

setInterval(() => {
  processAllScheduledDisconnects().catch((e) => console.error("scheduleDisconnect:", e));
}, SCHEDULER_MS);

setTimeout(() => {
  processAllScheduledDisconnects().catch((e) => console.error("scheduleDisconnect:", e));
}, 4000);
