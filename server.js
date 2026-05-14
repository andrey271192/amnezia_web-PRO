import express from "express";
import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3980);
const CONTAINER = process.env.AWG_CONTAINER || "amnezia-awg2";
const AWG_CONF = "/opt/amnezia/awg/awg0.conf";
const CLIENTS_JSON = "/opt/amnezia/awg/clientsTable";

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

async function dockerExec(cmd) {
  const { stdout, stderr } = await execDocker([
    "exec",
    CONTAINER,
    "sh",
    "-c",
    cmd,
  ]);
  return stdout + stderr;
}

async function dockerReadFile(remotePath) {
  const { stdout } = await execDocker(["exec", CONTAINER, "cat", remotePath]);
  return stdout;
}

async function dockerWriteFile(remotePath, content) {
  await execDocker(
    [
      "exec",
      "-i",
      CONTAINER,
      "sh",
      "-c",
      `cat > '${remotePath}.tmp' && mv '${remotePath}.tmp' '${remotePath}'`,
    ],
    content
  );
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

async function backupRemoteFiles() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await dockerExec(
    `cp '${AWG_CONF}' '${AWG_CONF}.bak-admin-${stamp}' 2>/dev/null || true`
  );
  await dockerExec(
    `cp '${CLIENTS_JSON}' '${CLIENTS_JSON}.bak-admin-${stamp}' 2>/dev/null || true`
  );
}

async function applySyncconf() {
  await dockerExec(
    `wg-quick strip '${AWG_CONF}' > /tmp/wg-admin-strip.conf && awg syncconf awg0 /tmp/wg-admin-strip.conf`
  );
}

async function loadState() {
  const [confText, tableText] = await Promise.all([
    dockerReadFile(AWG_CONF),
    dockerReadFile(CLIENTS_JSON),
  ]);
  const conf = splitAwgConf(confText);
  const clients = parseClientsTable(tableText);
  const peerByKey = new Map(conf.peers.map((p) => [p.publicKey, p]));
  return { confText, conf, clients, peerByKey };
}

async function inferPskFromConf(conf) {
  if (conf.peers.length) return conf.peers[0].presharedKey;
  try {
    const text = await dockerReadFile("/opt/amnezia/awg/wireguard_psk.key");
    return text.trim();
  } catch {
    return null;
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

app.get("/api/clients", requireAuth, async (_req, res) => {
  try {
    let wgShow = "";
    try {
      wgShow = await dockerExec(`awg show awg0`);
    } catch {
      wgShow = "";
    }
    const { conf, clients, peerByKey } = await loadState();
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
        creationDate: ud.creationDate || null,
        latestHandshake: ud.latestHandshake || null,
        dataReceived: ud.dataReceived || null,
        dataSent: ud.dataSent || null,
      };
    });
    res.json({
      container: CONTAINER,
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
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let ts;
  try {
    ts = normalizeDisconnectedAtOptional(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  try {
    await backupRemoteFiles();
    const { conf, clients } = await loadState();
    const peer = conf.peers.find((p) => p.publicKey === clientId);
    if (!peer) {
      return res.status(404).json({ error: "Peer not in config (already disabled?)" });
    }
    const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const ud = { ...(clients[idx].userData || {}) };
    ud.disabled = true;
    ud.disabledAt = ts;
    ud.lastDisconnectedAt = ts;
    ud.preservedPresharedKey = peer.presharedKey || ud.preservedPresharedKey;
    ud.preservedAllowedIPs = peer.allowedIPs || ud.preservedAllowedIPs;
    clients[idx] = { ...clients[idx], userData: ud };
    await dockerWriteFile(AWG_CONF, nextConfText);
    await dockerWriteFile(CLIENTS_JSON, stringifyClientsTable(clients));
    await applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/enable", requireAuth, async (req, res) => {
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await backupRemoteFiles();
    const { conf, clients } = await loadState();
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
      (await inferPskFromConf(conf));
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
    delete ud.preservedPresharedKey;
    delete ud.preservedAllowedIPs;
    clients[idx] = { ...clients[idx], userData: ud };
    await dockerWriteFile(AWG_CONF, nextConfText);
    await dockerWriteFile(CLIENTS_JSON, stringifyClientsTable(clients));
    await applySyncconf();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/disconnect-date", requireAuth, async (req, res) => {
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  let iso;
  try {
    iso = requireDisconnectedAt(req.body?.disconnectedAt);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  try {
    const { conf, clients, peerByKey } = await loadState();
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const peer = peerByKey.get(clientId);
    const ud = { ...(clients[idx].userData || {}) };
    ud.lastDisconnectedAt = iso;
    if (!peer) {
      ud.disabledAt = iso;
    }
    clients[idx] = { ...clients[idx], userData: ud };
    await dockerWriteFile(CLIENTS_JSON, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/rename", requireAuth, async (req, res) => {
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
    const { clients } = await loadState();
    const idx = clients.findIndex((c) => c.clientId === clientId);
    if (idx === -1) return res.status(404).json({ error: "Client not in clientsTable" });
    const ud = { ...(clients[idx].userData || {}), clientName: name };
    clients[idx] = { ...clients[idx], userData: ud };
    await dockerWriteFile(CLIENTS_JSON, stringifyClientsTable(clients));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/clients/delete", requireAuth, async (req, res) => {
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: "clientId required" });
  try {
    await backupRemoteFiles();
    const { conf, clients } = await loadState();
    const nextPeers = conf.peers.filter((p) => p.publicKey !== clientId);
    const nextClients = clients.filter((c) => c.clientId !== clientId);
    if (nextClients.length === clients.length) {
      return res.status(404).json({ error: "Client not in clientsTable" });
    }
    const nextConfText = serializeAwgConf(conf.head, nextPeers);
    await dockerWriteFile(AWG_CONF, nextConfText);
    await dockerWriteFile(CLIENTS_JSON, stringifyClientsTable(nextClients));
    await applySyncconf();
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
  console.log(`amnezia-admin on :${PORT} → docker:${CONTAINER}, data:${DATA_DIR}`);
});
