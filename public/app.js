const loginGate = document.querySelector("#login-gate");
const appRoot = document.querySelector("#app-root");
const loginForm = document.querySelector("#login-form");
const loginPassword = document.querySelector("#login-password");
const loginError = document.querySelector("#login-error");

const logoutBtn = document.querySelector("#logout");
const refreshBtn = document.querySelector("#refresh");
const rowsEl = document.querySelector("#rows");
const statusEl = document.querySelector("#status");
const peerCountEl = document.querySelector("#peer-count");
const wgShowEl = document.querySelector("#wg-show");

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

let dtMode = "disable";
/** @type {{ clientId: string, name: string } | null} */
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
  dtDialog.showModal();
}

function openEditDisconnectDialog(c) {
  dtMode = "edit";
  dtClient = c;
  dtTitle.textContent = "Дата последнего отключения";
  dtClientEl.textContent = c.name;
  dtOk.textContent = "Сохранить";
  const iso =
    c.lastDisconnectedAt || (!c.activeInConf && c.disabledAt) || new Date().toISOString();
  dtInput.value = isoToDatetimeLocal(iso);
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
      setStatus("Сохраняю дату…", false);
      await api("/api/clients/disconnect-date", {
        method: "POST",
        body: JSON.stringify({ clientId: dtClient.clientId, disconnectedAt: iso }),
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
  loginGate.classList.remove("hidden");
  loginGate.setAttribute("aria-hidden", "false");
  appRoot.classList.add("hidden");
}

function showApp() {
  loginGate.classList.add("hidden");
  loginGate.setAttribute("aria-hidden", "true");
  appRoot.classList.remove("hidden");
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

const dtRu = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatLastDisconnect(c) {
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
    peerCountEl.textContent = `${data.clients.length} в таблице · ${data.peerCount} peer в awg0.conf`;
    wgShowEl.textContent = data.wgShow || "";
    renderRows(data.clients);
    setStatus("", false);
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
    await loadClients();
  } else {
    showLogin();
    loginPassword.focus();
  }
}

boot();
