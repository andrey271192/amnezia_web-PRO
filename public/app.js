const loginGate = document.querySelector("#login-gate");
const appRoot = document.querySelector("#app-root");
const loginForm = document.querySelector("#login-form");
const loginPassword = document.querySelector("#login-password");
const loginError = document.querySelector("#login-error");

const logoutBtn = document.querySelector("#logout");
const refreshBtn = document.querySelector("#refresh");
const clockServerEl = document.querySelector("#clock-server");
const clockLocalEl = document.querySelector("#clock-local");
const clockZoneDiffEl = document.querySelector("#clock-zone-diff");
const clockSyncBtn = document.querySelector("#clock-sync");
const rowsEl = document.querySelector("#rows");
const statusEl = document.querySelector("#status");
const peerCountEl = document.querySelector("#peer-count");
const wgShowEl = document.querySelector("#wg-show");

const protoSwitch = document.querySelector("#proto-switch");
const protoSelect = document.querySelector("#proto-select");
const protoLabel = document.querySelector("#proto-label");

const pwForm = document.querySelector("#pw-form");
const pwCurrent = document.querySelector("#pw-current");
const pwNew = document.querySelector("#pw-new");
const pwNew2 = document.querySelector("#pw-new2");
const pwMsg = document.querySelector("#pw-msg");

const dtDialog = document.querySelector("#disconnect-dt-dialog");
const dtTitle = document.querySelector("#dt-dialog-title");
const dtClientEl = document.querySelector("#dt-dialog-client");
const dtInput = document.querySelector("#dt-dialog-input");
const dtCancel = document.querySelector("#dt-dialog-cancel");
const dtOk = document.querySelector("#dt-dialog-ok");
const dtExtra = document.querySelector("#dt-dialog-extra");
const dtHint = document.querySelector("#dt-dialog-hint");
const dtScheduleTunnel = document.querySelector("#dt-dialog-schedule-tunnel");

let dtMode = "disable";
/** @type {Record<string, unknown> | null} */
let dtClient = null;

function isoToDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(localVal) {
  if (!localVal || !String(localVal).trim()) {
    throw new Error("Укажите дату и время");
  }
  const d = new Date(localVal);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Некорректная дата");
  }
  return d.toISOString();
}

function openDisableDialog(c) {
  dtMode = "disable";
  dtClient = c;
  dtTitle.textContent = "Выключить клиента";
  dtClientEl.textContent = c.name;
  dtOk.textContent = "Выключить";
  dtInput.value = isoToDatetimeLocal(new Date().toISOString());
  dtExtra.classList.add("hidden");
  dtScheduleTunnel.checked = false;
  dtDialog.showModal();
}

function openEditDisconnectDialog(c) {
  dtMode = "edit";
  dtClient = c;
  dtTitle.textContent = "Дата последнего отключения";
  dtClientEl.textContent = c.name;
  dtOk.textContent = "Сохранить";
  const iso =
    (c.activeInConf && c.scheduledTunnelDisconnectAt) ||
    c.lastDisconnectedAt ||
    (!c.activeInConf && c.disabledAt) ||
    new Date().toISOString();
  dtInput.value = isoToDatetimeLocal(iso);
  if (c.activeInConf) {
    dtExtra.classList.remove("hidden");
    dtHint.textContent =
      "Без галочки — только запись даты в таблице, клиент остаётся в туннеле. С галочкой ключ будет убран из туннеля автоматически в выбранный момент (проверка на сервере каждые ~60 с).";
    dtScheduleTunnel.checked = Boolean(c.scheduledTunnelDisconnectAt);
  } else {
    dtExtra.classList.add("hidden");
    dtScheduleTunnel.checked = false;
  }
  dtDialog.showModal();
}

dtCancel.addEventListener("click", () => {
  dtDialog.close();
  dtClient = null;
});

dtOk.addEventListener("click", async () => {
  if (!dtClient) return;
  let iso;
  try {
    iso = datetimeLocalToIso(dtInput.value);
  } catch (e) {
    setStatus(String(e.message || e), true);
    return;
  }
  try {
    if (dtMode === "disable") {
      setStatus("Выполняю…", false);
      await api("/api/clients/disable", {
        method: "POST",
        body: JSON.stringify({ clientId: dtClient.clientId, disconnectedAt: iso }),
      });
    } else {
      const scheduleTunnel = Boolean(dtScheduleTunnel.checked && dtClient.activeInConf);
      setStatus(scheduleTunnel ? "Сохраняю расписание отключения…" : "Сохраняю дату…", false);
      await api("/api/clients/disconnect-date", {
        method: "POST",
        body: JSON.stringify({
          clientId: dtClient.clientId,
          disconnectedAt: iso,
          scheduleTunnelDisconnect: scheduleTunnel,
        }),
      });
    }
    dtDialog.close();
    dtClient = null;
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

function showLogin() {
  stopClocks();
  loginGate.classList.remove("hidden");
  loginGate.setAttribute("aria-hidden", "false");
  appRoot.classList.add("hidden");
}

function showApp() {
  loginGate.classList.add("hidden");
  loginGate.setAttribute("aria-hidden", "true");
  appRoot.classList.remove("hidden");
  startClocks();
}

function setStatus(text, isErr) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("err", Boolean(isErr));
}

function setPwMsg(text, isErr) {
  pwMsg.textContent = text || "";
  pwMsg.classList.toggle("err", Boolean(isErr));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data.error || data.raw || res.statusText;
    throw new Error(msg);
  }
  return data;
}

async function checkSession() {
  try {
    await api("/api/session");
    return true;
  } catch {
    return false;
  }
}

async function loadProtocols() {
  try {
    const data = await api("/api/protocols");
    protoLabel.textContent = `Протокол: ${data.currentLabel || "AmneziaWG"}`;
    if (!data.profiles || data.profiles.length < 2) {
      protoSwitch.classList.add("hidden");
      return;
    }
    protoSwitch.classList.remove("hidden");
    protoSelect.innerHTML = "";
    for (const p of data.profiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.label} (${p.container})`;
      if (p.id === data.currentId) opt.selected = true;
      protoSelect.appendChild(opt);
    }
  } catch {
    protoSwitch.classList.add("hidden");
  }
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: loginPassword.value }),
    });
    loginPassword.value = "";
    showApp();
    await loadProtocols();
    await loadTimeSyncCaps();
    await loadClients();
  } catch (e) {
    loginError.textContent = String(e.message || e);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    /* ignore */
  }
  showLogin();
  loginPassword.focus();
});

refreshBtn.addEventListener("click", () => {
  loadClients();
});

protoSelect.addEventListener("change", async () => {
  try {
    setStatus("Смена инстанса…", false);
    await api("/api/protocol", {
      method: "POST",
      body: JSON.stringify({ profileId: protoSelect.value }),
    });
    await loadProtocols();
    await loadClients();
    setStatus("", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
    await loadProtocols();
  }
});

clockSyncBtn.addEventListener("click", () => {
  void refreshServerClock();
});

const clockFmt = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "medium",
});

/** Часовой пояс строки «Сервер» (IANA), как в /api/server-time */
let serverDisplayTz = "UTC";
/** @type {Intl.DateTimeFormat | null} */
let serverTzFmtCached = null;

function buildServerTzFmt(tz) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: tz,
    });
  } catch {
    return null;
  }
}

/** @type {ReturnType<typeof setInterval> | null} */
let clockTickId = null;
/** @type {ReturnType<typeof setInterval> | null} */
let clockServerPollId = null;

/** Метка UTC сервера (мс) по последнему ответу API */
let serverAnchorUtcMs = /** @type {number | null} */ (null);
/** Date.now() в момент установки якоря */
let serverAnchorWallMs = 0;

function browserTimeZoneLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function tickServerClockDisplay() {
  if (serverAnchorUtcMs === null) {
    clockServerEl.dateTime = "";
    clockServerEl.textContent = "—";
    return;
  }
  const estimatedUtcMs = serverAnchorUtcMs + (Date.now() - serverAnchorWallMs);
  const d = new Date(estimatedUtcMs);
  clockServerEl.dateTime = d.toISOString();
  const fmt = serverTzFmtCached || clockFmt;
  clockServerEl.textContent = `${fmt.format(d)} · ${serverDisplayTz}`;
}

async function refreshServerClock() {
  try {
    const tz = browserTimeZoneLabel();
    const q = tz ? `?browserTz=${encodeURIComponent(tz)}` : "";
    const t = await api(`/api/server-time${q}`);
    const iso = typeof t.iso === "string" ? t.iso : "";
    const parsed = new Date(iso).getTime();
    if (!iso || Number.isNaN(parsed)) {
      throw new Error("нет времени");
    }
    serverAnchorUtcMs = parsed;
    serverAnchorWallMs = Date.now();
    serverDisplayTz =
      typeof t.timeZone === "string" && t.timeZone.trim() ? t.timeZone.trim() : "UTC";
    serverTzFmtCached = buildServerTzFmt(serverDisplayTz);
    tickServerClockDisplay();
    if (clockZoneDiffEl) {
      const hint = typeof t.zoneCompareHint === "string" ? t.zoneCompareHint.trim() : "";
      if (hint) {
        clockZoneDiffEl.textContent = hint;
        clockZoneDiffEl.classList.remove("hidden");
        clockZoneDiffEl.classList.toggle("clock-zone-diff--accent", t.zoneSame === false);
      } else {
        clockZoneDiffEl.textContent = "";
        clockZoneDiffEl.classList.add("hidden");
        clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
      }
    }
  } catch {
    serverAnchorUtcMs = null;
    serverTzFmtCached = null;
    clockServerEl.dateTime = "";
    clockServerEl.textContent = "—";
    if (clockZoneDiffEl) {
      clockZoneDiffEl.textContent = "";
      clockZoneDiffEl.classList.add("hidden");
      clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
    }
  }
}

function tickLocalClock() {
  const n = new Date();
  clockLocalEl.dateTime = n.toISOString();
  const tz = browserTimeZoneLabel();
  clockLocalEl.textContent = tz ? `${clockFmt.format(n)} · ${tz}` : clockFmt.format(n);
}

function tickClocks() {
  tickLocalClock();
  tickServerClockDisplay();
}

function stopClocks() {
  if (clockTickId !== null) {
    clearInterval(clockTickId);
    clockTickId = null;
  }
  if (clockServerPollId !== null) {
    clearInterval(clockServerPollId);
    clockServerPollId = null;
  }
  serverAnchorUtcMs = null;
  serverAnchorWallMs = 0;
  serverTzFmtCached = null;
  serverDisplayTz = "UTC";
  clockServerEl.dateTime = "";
  clockLocalEl.dateTime = "";
  clockServerEl.textContent = "—";
  clockLocalEl.textContent = "—";
  if (clockZoneDiffEl) {
    clockZoneDiffEl.textContent = "";
    clockZoneDiffEl.classList.add("hidden");
    clockZoneDiffEl.classList.remove("clock-zone-diff--accent");
  }
}

function startClocks() {
  stopClocks();
  tickClocks();
  void refreshServerClock();
  clockTickId = setInterval(tickClocks, 1000);
  clockServerPollId = setInterval(() => void refreshServerClock(), 30_000);
}

async function loadTimeSyncCaps() {
  const hint = document.querySelector("#sync-host-hint");
  const btn = document.querySelector("#sync-host-time");
  try {
    const c = await api("/api/time-sync-capabilities");
    if (hint) {
      hint.textContent = c.hostTimeSync
        ? `Записывается UTC-момент с этого устройства на хост по SSH (root@${c.sshHost}). Пояс строки «Сервер»: ${c.serverClockTimeZone}. Пароль не сохраняется.`
        : `Авто-синхронизация по SSH недоступна (или TIME_SYNC_DISABLED). Пояс «Сервер»: ${c.serverClockTimeZone}. Задайте TZ контейнера панели при необходимости — см. README.`;
    }
    if (btn) btn.disabled = !c.hostTimeSync;
  } catch {
    if (hint) hint.textContent = "";
    if (btn) btn.disabled = true;
  }
}

document.querySelector("#sync-host-time")?.addEventListener("click", async () => {
  const inp = document.querySelector("#sync-root-pw");
  const pw = inp && typeof inp.value === "string" ? inp.value : "";
  if (!pw.trim()) {
    setStatus("Введите пароль root на хосте.", true);
    return;
  }
  try {
    setStatus("Беру время с этого устройства и отправляю на хост…", false);
    await api("/api/sync-host-time", {
      method: "POST",
      body: JSON.stringify({ rootPassword: pw, unixMs: Date.now() }),
    });
    inp.value = "";
    setStatus("Готово: часы хоста выставлены по вашему устройству (UTC). Проверьте строки времени.", false);
    void refreshServerClock();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
});

const dtRu = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatLastDisconnect(c) {
  if (c.scheduledTunnelDisconnectAt && c.activeInConf) {
    const d = new Date(String(c.scheduledTunnelDisconnectAt));
    if (!Number.isNaN(d.getTime())) {
      return `${dtRu.format(d)} · авто`;
    }
  }
  const iso =
    c.lastDisconnectedAt ||
    (!c.activeInConf && c.disabledAt) ||
    null;
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dtRu.format(d);
}

pwForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  setPwMsg("", false);
  if (pwNew.value !== pwNew2.value) {
    setPwMsg("Новый пароль и повтор не совпадают.", true);
    return;
  }
  try {
    const data = await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: pwCurrent.value,
        newPassword: pwNew.value,
      }),
    });
    pwCurrent.value = "";
    pwNew.value = "";
    pwNew2.value = "";
    setPwMsg(data.message || "Готово.", false);
    showLogin();
    loginPassword.focus();
  } catch (e) {
    setPwMsg(String(e.message || e), true);
  }
});

function renderRows(clients) {
  rowsEl.innerHTML = "";
  clients.forEach((c) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameWrap = document.createElement("div");
    nameWrap.className = "name-cell";
    const strong = document.createElement("strong");
    strong.textContent = c.name;
    const renameWrap = document.createElement("div");
    renameWrap.className = "rename-inline";
    renameWrap.appendChild(
      btn("Переименовать", "btn small ghost", () => void renameClient(c))
    );
    nameWrap.append(strong, renameWrap);
    nameTd.appendChild(nameWrap);

    const ipTd = document.createElement("td");
    ipTd.innerHTML = `<span class="ip">${escapeHtml(c.allowedIps || "—")}</span>`;

    const stTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${c.activeInConf ? "on" : "off"}`;
    badge.textContent = c.activeInConf ? "В туннеле" : "Выключен";
    stTd.appendChild(badge);

    const offTd = document.createElement("td");
    offTd.className = "date-cell";
    const dateLine = document.createElement("div");
    dateLine.textContent = formatLastDisconnect(c);
    const dtWrap = document.createElement("div");
    dtWrap.className = "rename-inline";
    dtWrap.appendChild(
      btn("Задать дату", "btn small ghost", () => openEditDisconnectDialog(c))
    );
    offTd.append(dateLine, dtWrap);

    const actTd = document.createElement("td");
    actTd.className = "actions";

    if (c.activeInConf) {
      actTd.appendChild(btn("Выключить", "btn small ghost", () => openDisableDialog(c)));
    } else {
      actTd.appendChild(
        btn("Включить", "btn small primary", () => mutate("/api/clients/enable", c.clientId))
      );
    }
    actTd.appendChild(btn("Удалить", "btn small warn", () => confirmDelete(c.name, c.clientId)));

    tr.append(nameTd, ipTd, stTd, offTd, actTd);
    rowsEl.appendChild(tr);
  });
}

function btn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renameClient(c) {
  const next = prompt(`Новое имя для «${c.name}»:`, c.name);
  if (next === null) return;
  const trimmed = next.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    setStatus("Имя не может быть пустым", true);
    return;
  }
  try {
    setStatus("Сохраняю имя…", false);
    await api("/api/clients/rename", {
      method: "POST",
      body: JSON.stringify({ clientId: c.clientId, name: trimmed }),
    });
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function mutate(path, clientId) {
  try {
    setStatus("Выполняю…", false);
    await api(path, { method: "POST", body: JSON.stringify({ clientId }) });
    setStatus("Готово.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function confirmDelete(name, clientId) {
  const ok = confirm(
    `Удалить клиента «${name}»? Конфиг из приложения Amnezia перестанет совпадать с сервером.`
  );
  if (!ok) return;
  await mutate("/api/clients/delete", clientId);
}

async function loadClients() {
  try {
    setStatus("Загрузка…", false);
    const data = await api("/api/clients");
    const pref = data.profileLabel ? `${data.profileLabel} · ` : "";
    peerCountEl.textContent = `${pref}${data.clients.length} в таблице · ${data.peerCount} peer`;
    wgShowEl.textContent = data.wgShow || "";
    renderRows(data.clients);
    setStatus("", false);
    void refreshServerClock();
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes("Unauthorized")) {
      showLogin();
      setStatus("", false);
      loginError.textContent = "Сессия истекла — войдите снова.";
      return;
    }
    setStatus(msg, true);
    rowsEl.innerHTML = "";
    wgShowEl.textContent = "";
    peerCountEl.textContent = "";
  }
}

async function boot() {
  const ok = await checkSession();
  if (ok) {
    showApp();
    await loadProtocols();
    await loadTimeSyncCaps();
    await loadClients();
  } else {
    showLogin();
    loginPassword.focus();
  }
}

boot();
