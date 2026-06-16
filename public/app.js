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

const warpPanel = document.querySelector("#warp-panel");
const warpStatusLine = document.querySelector("#warp-status-line");
const warpActionsEl = document.querySelector("#warp-actions");
const warpClientListEl = document.querySelector("#warp-client-list");
const warpWgShowEl = document.querySelector("#warp-wg-show");

const mtprotoPanel = document.querySelector("#mtproto-panel");
const mtprotoStatusLine = document.querySelector("#mtproto-status-line");
const mtprotoActionsEl = document.querySelector("#mtproto-actions");
const mtprotoLogsTailEl = document.querySelector("#mtproto-logs-tail");
const mtprotoBanner = document.querySelector("#mtproto-banner");
const mtprotoHostPortInput = document.querySelector("#mtproto-host-port");
const mtprotoSecretInput = document.querySelector("#mtproto-secret-opt");
const mtprotoCalloutEl = document.querySelector("#mtproto-callout");
const mtprotoLinkCardEl = document.querySelector("#mtproto-link-card");
const mtprotoLinkAnchorEl = document.querySelector("#mtproto-link-anchor");
const mtprotoLinkCopyBtn = document.querySelector("#mtproto-link-copy");
const mtprotoLinkCopyState = document.querySelector("#mtproto-link-copy-state");

const cascadePanel = document.querySelector("#cascade-panel");
const usersPanel = document.querySelector("#users-panel");
const wgRawDetails = document.querySelector("#wg-raw-details");

const protoSwitch = document.querySelector("#proto-switch");
const protoSelect = document.querySelector("#proto-select");
const protoLabel = document.querySelector("#proto-label");

const pwForm = document.querySelector("#pw-form");
const pwCurrent = document.querySelector("#pw-current");
const pwNew = document.querySelector("#pw-new");
const pwNew2 = document.querySelector("#pw-new2");
const pwMsg = document.querySelector("#pw-msg");

const profileHintEl = document.querySelector("#profile-hint");

const dtDialog = document.querySelector("#disconnect-dt-dialog");
const dtTitle = document.querySelector("#dt-dialog-title");
const dtClientEl = document.querySelector("#dt-dialog-client");
const dtInput = document.querySelector("#dt-dialog-input");
const dtCancel = document.querySelector("#dt-dialog-cancel");
const dtOk = document.querySelector("#dt-dialog-ok");
const dtExtra = document.querySelector("#dt-dialog-extra");
const dtHint = document.querySelector("#dt-dialog-hint");
const dtScheduleTunnel = document.querySelector("#dt-dialog-schedule-tunnel");

const warpSshDialog = document.querySelector("#warp-ssh-dialog");
const warpSshTitle = document.querySelector("#warp-ssh-title");
const warpSshLead = document.querySelector("#warp-ssh-lead");
const warpSshPw = document.querySelector("#warp-ssh-pw");
const warpSshCancel = document.querySelector("#warp-ssh-cancel");
const warpSshOk = document.querySelector("#warp-ssh-ok");
const warpSshErr = document.querySelector("#warp-ssh-err");
/** @type {"install" | "uninstall" | null} */
let warpSshPendingCmd = null;

/** Какие панели скрыты настройкой сервера (`UI_HIDE_SECTIONS`). */
let uiHidden = { users: false, warp: false, cascade: false, mtproto: false };

const editionBanner = document.querySelector("#edition-banner");
const DEFAULT_HEADER_SUB = document.querySelector(".top .sub")?.textContent?.trim() || "";

/** Состояние редакции панели (community = только просмотр клиентов). */
let editionState = {
  tier: "pro",
  readOnlyClients: false,
  upgradeUrl: null,
  upgradePitch: null,
  showDebugWg: true,
};

function applyEditionPayload(data) {
  const ed = data?.edition;
  if (!ed || typeof ed !== "object") return;
  editionState = {
    tier: ed.tier === "community" ? "community" : "pro",
    readOnlyClients: Boolean(ed.readOnlyClients),
    upgradeUrl: typeof ed.upgradeUrl === "string" ? ed.upgradeUrl : null,
    upgradePitch: typeof ed.upgradePitch === "string" ? ed.upgradePitch : null,
    showDebugWg: ed.showDebugWg !== false,
  };
  const titleEl = document.querySelector(".top h1");
  if (titleEl) {
    titleEl.textContent =
      editionState.tier === "community"
        ? "Пользователи AmneziaWG FREE"
        : "Пользователи AmneziaWG PRO";
  }
  const subEl = document.querySelector(".top .sub");
  if (subEl) {
    if (editionState.tier === "community") {
      subEl.textContent =
        "Базовая панель amnezia_web: только просмотр клиентов AmneziaWG и статусов. Управление туннелем, экспорт .conf, каскад, Cloudflare WARP, MTProto‑прокси Telegram и синхронизация времени хоста — в версии PRO.";
    } else {
      subEl.textContent = DEFAULT_HEADER_SUB;
    }
  }
  if (editionBanner) {
    if (editionState.tier === "community") {
      editionBanner.classList.remove("hidden");
      editionBanner.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "edition-banner-inner";
      const textCol = document.createElement("div");
      textCol.className = "edition-banner-text";
      const strong = document.createElement("strong");
      strong.textContent = "Базовая версия · только просмотр";
      const pitch = document.createElement("p");
      pitch.className = "edition-banner-pitch muted";
      pitch.textContent = editionState.upgradePitch || "";
      textCol.append(strong, pitch);
      const cta = document.createElement("a");
      cta.className = "btn small primary edition-banner-cta";
      cta.rel = "noopener noreferrer";
      cta.target = "_blank";
      cta.href =
        editionState.upgradeUrl ||
        "https://github.com/andrey271192/amnezia_web-PRO";
      cta.textContent = "Открыть PRO на GitHub";
      wrap.append(textCol, cta);
      editionBanner.appendChild(wrap);
    } else {
      editionBanner.classList.add("hidden");
      editionBanner.innerHTML = "";
    }
  }
  document.querySelector(".clock-host-sync")?.classList.toggle("hidden", editionState.readOnlyClients);
  if (wgRawDetails) wgRawDetails.hidden = uiHidden.users || !editionState.showDebugWg;
}

/** @param {string} [tgLink] */
function setMtprotoLinkCard(tgLink) {
  const t = typeof tgLink === "string" ? tgLink.trim() : "";
  if (!mtprotoLinkCardEl) return;
  if (!t) {
    mtprotoLinkCardEl.classList.add("hidden");
    delete mtprotoLinkCardEl.dataset.tgLink;
    if (mtprotoLinkAnchorEl) {
      mtprotoLinkAnchorEl.removeAttribute("href");
      mtprotoLinkAnchorEl.textContent = "";
    }
    return;
  }
  mtprotoLinkCardEl.classList.remove("hidden");
  mtprotoLinkCardEl.dataset.tgLink = t;
  if (mtprotoLinkAnchorEl) {
    mtprotoLinkAnchorEl.href = t;
    mtprotoLinkAnchorEl.textContent = t;
  }
  if (mtprotoLinkCopyState) mtprotoLinkCopyState.textContent = "";
}

async function refreshMtprotoPanel() {
  if (!mtprotoPanel || !mtprotoStatusLine || !mtprotoActionsEl) return;
  if (uiHidden.mtproto) {
    mtprotoPanel.hidden = true;
    if (mtprotoCalloutEl) {
      mtprotoCalloutEl.textContent = "";
      mtprotoCalloutEl.classList.add("hidden");
    }
    setMtprotoLinkCard("");
    return;
  }
  mtprotoPanel.hidden = false;
  mtprotoActionsEl.innerHTML = "";
  if (mtprotoBanner) {
    mtprotoBanner.classList.add("hidden");
    mtprotoBanner.textContent = "";
  }
  try {
    if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = "Загрузка логов…";
    const snap = await api("/api/mtproto/status?withLogs=1");
    if (snap.logsFetched !== true && snap.exists === true && snap.running === true) {
      void (async () => {
        try {
          const lg =
            (await api("/api/mtproto/tail").catch(() => api("/api/mtproto/logs"))) ||
            ({ logsTail: "" });
          const tail = typeof lg?.logsTail === "string" ? lg.logsTail : "";
          if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = tail;
        } catch {
          if (mtprotoLogsTailEl) {
            mtprotoLogsTailEl.textContent = "(лог не загрузился — обновите раздел позже)";
          }
        }
      })();
    } else {
      const tail = typeof snap.logsTail === "string" ? snap.logsTail : "";
      if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = tail;
    }

    if (mtprotoCalloutEl) {
      if (snap.exists) {
        const hp =
          snap.hostPort != null && snap.hostPort !== "" ? String(snap.hostPort) : null;
        mtprotoCalloutEl.classList.remove("hidden");
        mtprotoCalloutEl.textContent = hp
          ? `Официальный образ слушает 443/tcp внутри контейнера — это норма. На хост проброшен порт ${hp}: в Telegram указывайте публичный IP/DNS этого VPS и порт ${hp}. В логах ниже официальный прокси сам пишет tg:// и port=443 (внутренний процесс); при таком пробросе в клиенте используйте порт ${hp}, а не 443. Ссылку из синего блока панели (если показана) можно открыть как есть.`
          : `Официальный образ слушает 443/tcp внутри контейнера; снаружи — порт хоста из строки статуса («порт хоста»). Если в логах видно tg:// с port=443, для подключения с интернета подставляйте порт хоста из статуса, не 443.`;
      } else {
        mtprotoCalloutEl.textContent = "";
        mtprotoCalloutEl.classList.add("hidden");
      }
    }

    const parts = [];
    if (snap.exists) parts.push("контейнер есть");
    if (snap.running) parts.push("запущен");
    mtprotoStatusLine.textContent =
      parts.length > 0
        ? `${parts.join(" · ")}${
            snap.hostPort ? ` · порт хоста :${String(snap.hostPort)}` : ""
          }${snap.secretMasked ? ` · секрет ${snap.secretMasked}` : ""}`
        : "не установлен";

    if (typeof snap.hint === "string" && snap.hint.trim()) {
      const hintEl = document.createElement("p");
      hintEl.className = "muted warp-muted";
      hintEl.textContent = snap.hint.trim();
      mtprotoActionsEl.appendChild(hintEl);
    } else if (snap.exists && !snap.running && typeof snap.image === "string" && snap.image.trim()) {
      const imgHint = document.createElement("p");
      imgHint.className = "muted warp-muted";
      imgHint.textContent = `После установки образ будет доступен здесь (${snap.image.trim()} при актуальной конфигурации).`;
      mtprotoActionsEl.appendChild(imgHint);
    }

    setMtprotoLinkCard(snap.tgLink);

    const row = document.createElement("div");
    row.className = "warp-actions";

    row.appendChild(
      btn("Установить / пересоздать", "btn small primary", async () => {
        try {
          setStatus("MTProto: docker pull/run…", false);
          const hp = mtprotoHostPortInput?.value?.trim();
          const sec = mtprotoSecretInput?.value?.trim()?.toLowerCase();
          const body = {};
          if (hp !== "" && hp !== undefined) {
            const n = Number.parseInt(String(hp), 10);
            if (Number.isFinite(n)) body.hostPort = n;
          }
          if (/^[a-f0-9]{32}$/.test(sec)) body.secret = sec;
          const j = await api("/api/mtproto/install", { method: "POST", body: JSON.stringify(body) });
          if (typeof j.tgLink === "string" && j.tgLink.trim()) setMtprotoLinkCard(j.tgLink.trim());
          const lines = [];
          if (typeof j.secretHex === "string") lines.push(`Секрет (сохраните): ${j.secretHex}`);
          if (typeof j.tgLink === "string" && j.tgLink) lines.push(`Ссылка: ${j.tgLink}`);
          if (mtprotoBanner) {
            mtprotoBanner.textContent = lines.join("\n");
            mtprotoBanner.classList.remove("hidden");
          }
          if (typeof j.secretHex === "string" && mtprotoSecretInput) mtprotoSecretInput.value = "";
          await refreshMtprotoPanel();
          setStatus("MTProto: готово", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Перезапустить", "btn small ghost", async () => {
        try {
          setStatus("MTProto: перезапуск…", false);
          await api("/api/mtproto/restart", { method: "POST", body: JSON.stringify({}) });
          await refreshMtprotoPanel();
          setStatus("", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Удалить прокси", "btn small warn", async () => {
        try {
          if (
            !confirm(
              "Удалить контейнер MTProto? Секрет в Telegram сохранять не нужно — он пересоздастся заново при установке.",
            )
          )
            return;
          setStatus("MTProto: удаление…", false);
          await api("/api/mtproto/remove", { method: "POST", body: JSON.stringify({}) });
          if (mtprotoBanner) {
            mtprotoBanner.classList.add("hidden");
            mtprotoBanner.textContent = "";
          }
          await refreshMtprotoPanel();
          setStatus("", false);
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    row.appendChild(
      btn("Обновить статус", "btn small ghost", async () => {
        try {
          setStatus("", false);
          await refreshMtprotoPanel();
        } catch (e) {
          setStatus(String(e?.message || e), true);
        }
      }),
    );

    mtprotoActionsEl.appendChild(row);
  } catch (e) {
    if (mtprotoCalloutEl) {
      mtprotoCalloutEl.textContent = "";
      mtprotoCalloutEl.classList.add("hidden");
    }
    setMtprotoLinkCard("");
    if (mtprotoLogsTailEl) mtprotoLogsTailEl.textContent = "";
    const err = document.createElement("p");
    err.className = "muted warp-muted err";
    err.textContent = String(e.message || e);
    mtprotoActionsEl.appendChild(err);
  }
}

function applyUiHiddenFromPayload(data) {
  const u = data?.uiHidden;
  if (u && typeof u === "object") {
    uiHidden = {
      users: Boolean(u.users),
      warp: Boolean(u.warp),
      cascade: Boolean(u.cascade),
      mtproto: Boolean(u.mtproto),
    };
  }
  if (usersPanel) usersPanel.hidden = uiHidden.users;
  if (wgRawDetails) wgRawDetails.hidden = uiHidden.users || !editionState.showDebugWg;
  if (cascadePanel) cascadePanel.hidden = uiHidden.cascade;
  if (warpPanel) warpPanel.hidden = uiHidden.warp;
  if (mtprotoPanel) mtprotoPanel.hidden = uiHidden.mtproto;
  void refreshMtprotoPanel();
}

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

function openWarpHostSetup(cmd) {
  if (!warpSshDialog || !warpSshTitle || !warpSshLead || !warpSshPw || !warpSshOk || !warpSshErr) return;
  warpSshPendingCmd = cmd;
  warpSshErr.textContent = "";
  warpSshPw.value = "";
  if (cmd === "install") {
    warpSshTitle.textContent = "Установить Cloudflare WARP";
    warpSshLead.textContent =
      "На хосте VPS выполнится scripts/warp-amnezia.sh install для контейнера текущего инстанса. SSH так же, как у блока синхронизации времени (TIME_SYNC_SSH_HOST, часто 172.17.0.1). Пароль root не сохраняется.";
    warpSshOk.textContent = "Установить";
  } else {
    warpSshTitle.textContent = "Удалить Cloudflare WARP";
    warpSshLead.textContent =
      "На хосте выполнится scripts/warp-amnezia.sh uninstall (интерфейс warp, правила, автозапуск в start.sh; контейнер AWG перезапустится).";
    warpSshOk.textContent = "Удалить";
  }
  warpSshDialog.showModal();
}

if (warpSshCancel && warpSshDialog) {
  warpSshCancel.addEventListener("click", () => {
    warpSshDialog.close();
    warpSshPendingCmd = null;
  });
}

if (warpSshOk && warpSshDialog && warpSshPw) {
  warpSshOk.addEventListener("click", async () => {
    const cmd = warpSshPendingCmd;
    if (!cmd) return;
    const pw = warpSshPw.value;
    if (!String(pw).trim()) {
      warpSshErr.textContent = "Введите пароль root.";
      return;
    }
    warpSshErr.textContent = "";
    try {
      setStatus(cmd === "install" ? "Устанавливаю WARP на хосте VPS…" : "Удаляю WARP на хосте VPS…", false);
      await api("/api/warp/host-setup", {
        method: "POST",
        body: JSON.stringify({ rootPassword: pw, cmd }),
      });
      warpSshDialog.close();
      warpSshPendingCmd = null;
      warpSshPw.value = "";
      setStatus("Готово.", false);
      await loadClients();
    } catch (e) {
      const msg = String(e.message || e);
      warpSshErr.textContent = msg;
      setStatus(msg, true);
    }
  });
}

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
  const pathOnly =
    typeof path === "string" ? path.trim().replace(/\?.*$/, "") || String(path).trim() : "";
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
    let msg = typeof data.error === "string" ? data.error : "";
    if (!msg) msg = typeof data.raw === "string" ? data.raw : "";
    if (!msg) msg = res.statusText;
    const hint = typeof data.hint === "string" && data.hint.trim() ? data.hint.trim() : "";
    if (hint) {
      msg = msg ? `${msg} — ${hint}` : hint;
    } else if (
      res.status === 404 &&
      /^\/api\/mtproto\b/.test(pathOnly) &&
      /^not\s*found\s*$/i.test(String(msg).trim())
    ) {
      msg = `${msg.trim()} — проверьте GET /health (version): образ панели должен включать GET /api/mtproto/status, а прокси — весь /api/.`;
    }
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
    applyEditionPayload(data);
    protoLabel.textContent = `Протокол: ${data.currentLabel || "AmneziaWG"}`;
    if (profileHintEl) {
      if (data.singleProfile && typeof data.profilesPersistHint === "string" && data.profilesPersistHint) {
        profileHintEl.textContent = data.profilesPersistHint;
        profileHintEl.classList.remove("hidden");
      } else {
        profileHintEl.textContent = "";
        profileHintEl.classList.add("hidden");
      }
    }
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
    await loadInstances();
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
  loadInstances();
});

const cascadeForm = document.querySelector("#cascade-form");
if (cascadeForm) {
  cascadeForm.addEventListener("submit", (ev) => void downloadCascadeConf(ev));
}

const directForm = document.querySelector("#direct-form");
if (directForm) {
  directForm.addEventListener("submit", (ev) => void downloadDirectConf(ev));
}

const instanceForm = document.querySelector("#instance-form");
if (instanceForm) {
  instanceForm.addEventListener("submit", (ev) => void createInstance(ev));
}

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
    if (editionState.readOnlyClients || c.communityBlocked) {
      if (hint) {
        hint.textContent =
          "В базовой версии синхронизация времени хоста по SSH недоступна — это функция PRO.";
      }
      if (btn) btn.disabled = true;
      return;
    }
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
  if (uiHidden.users) return;
  clients.forEach((c) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameWrap = document.createElement("div");
    nameWrap.className = "name-cell";
    const strong = document.createElement("strong");
    strong.textContent = c.name;
    if (!editionState.readOnlyClients) {
      const renameWrap = document.createElement("div");
      renameWrap.className = "rename-inline";
      renameWrap.appendChild(
        btn("Переименовать", "btn small ghost", () => void renameClient(c))
      );
      nameWrap.append(strong, renameWrap);
      if (!c.exportAvailable) {
        const hintFold = document.createElement("details");
        hintFold.className = "hint-mini";
        const sum = document.createElement("summary");
        sum.textContent = "Нет готового .conf на сервере (last_config)";
        hintFold.appendChild(sum);
        const exHint = document.createElement("p");
        exHint.className = "muted export-missing-hint";
        exHint.textContent =
          "Конфиг с сервера недоступен (нет last_config). Создайте клиента с нужным Endpoint в блоке «Новый клиент под каскад» ниже или возьмите ключ из приложения Amnezia.";
        hintFold.appendChild(exHint);
        nameWrap.appendChild(hintFold);
      }
    } else {
      nameWrap.appendChild(strong);
      const roHint = document.createElement("p");
      roHint.className = "muted hint-mini";
      roHint.style.margin = "0.35rem 0 0";
      roHint.textContent = c.exportAvailable
        ? "На сервере есть данные для .conf — скачивание доступно в PRO."
        : "Нет last_config на сервере — полный конфиг в приложении Amnezia.";
      nameWrap.appendChild(roHint);
    }
    nameTd.appendChild(nameWrap);

    const ipTd = document.createElement("td");
    ipTd.innerHTML = `<span class="ip">${escapeHtml(c.allowedIps || "—")}</span>`;

    const stTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${c.activeInConf ? "on" : "off"}`;
    if (c.activeInConf && c.warpEnabled) {
      badge.textContent = "В туннеле · WARP";
    } else {
      badge.textContent = c.activeInConf ? "В туннеле" : "Выключен";
    }
    stTd.appendChild(badge);

    const offTd = document.createElement("td");
    offTd.className = "date-cell";
    const dateLine = document.createElement("div");
    dateLine.textContent = formatLastDisconnect(c);
    offTd.appendChild(dateLine);
    if (!editionState.readOnlyClients) {
      const dtWrap = document.createElement("div");
      dtWrap.className = "rename-inline";
      dtWrap.appendChild(
        btn("Задать дату", "btn small ghost", () => openEditDisconnectDialog(c))
      );
      offTd.appendChild(dtWrap);
    }

    const actTd = document.createElement("td");
    actTd.className = "actions";

    if (editionState.readOnlyClients) {
      const lock = document.createElement("span");
      lock.className = "muted";
      lock.textContent = "Только PRO";
      actTd.appendChild(lock);
    } else {
      if (c.activeInConf) {
        actTd.appendChild(iconBtn("⏻", "Выключить", "btn small ghost icon", () => openDisableDialog(c)));
      } else {
        actTd.appendChild(
          iconBtn("▶", "Включить", "btn small primary icon", () => mutate("/api/clients/enable", c.clientId))
        );
      }
      if (c.exportAvailable) {
        const direct = document.createElement("a");
        direct.className = "btn small ghost";
        direct.href = clientExportGetUrl(c.clientId);
        direct.textContent = "🔗"; direct.classList.add("icon");
        direct.rel = "noopener";
        direct.title =
          "Открыть в новой вкладке — скачается .conf, если вы авторизованы в этой панели (cookies).";

        actTd.appendChild(iconBtn("⬇", "Скачать .conf", "btn small ghost icon", () => void downloadClientConfig(c)));
        actTd.appendChild(direct);
        actTd.appendChild(
          iconBtn("⧉", "Копировать URL", "btn small ghost icon", async () => {
            const ok = await copyTextToClipboard(clientExportGetUrl(c.clientId));
            setStatus(ok ? "Ссылка скопирована (вставьте в браузер, будучи залогиненным)." : "Не удалось скопировать.", !ok);
          }),
        );
      }
      actTd.appendChild(iconBtn("🗑", "Удалить", "btn small warn icon", () => confirmDelete(c.name, c.clientId)));
    }

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

function iconBtn(glyph, title, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = glyph;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

/** Для политики WARP на сервере нужны IPv4 вида 10.8.x.x/32 */
function parseIpv4Cidrs(allowedIps) {
  if (!allowedIps) return [];
  return String(allowedIps)
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^(\d{1,3}\.){3}\d{1,3}\/\d{1,3}$/.test(x));
}

/** @param {{ warp?: Record<string, unknown>; clients: Record<string, unknown>[] }} data */
function renderWarpPanel(data) {
  if (!warpPanel || !warpStatusLine || !warpActionsEl || !warpClientListEl || !warpWgShowEl) return;
  if (uiHidden.warp) {
    warpPanel.hidden = true;
    return;
  }
  const w = data.warp;
  if (!w || w.supported === false) {
    warpPanel.hidden = true;
    return;
  }
  warpPanel.hidden = false;
  warpActionsEl.innerHTML = "";
  warpClientListEl.innerHTML = "";
  warpWgShowEl.textContent = typeof w.wgShowWarp === "string" ? w.wgShowWarp : "";

  if (!w.installed) {
    warpStatusLine.textContent = "Не установлен";
    const explain = document.createElement("p");
    explain.className = "muted warp-muted";
    explain.textContent =
      "Так и должно быть, пока на VPS не создан файл warp.conf внутри контейнера AWG. После установки статус сменится; без WARP обычный AmneziaWG уже работает.";
    warpActionsEl.appendChild(explain);

    if (w.hostSshInstall) {
      warpActionsEl.appendChild(
        btn("Установить WARP на VPS", "btn small primary", () => openWarpHostSetup("install")),
      );
      const sshHint = document.createElement("p");
      sshHint.className = "muted warp-muted";
      sshHint.textContent =
        "Кнопка запускает на хосте тот же скрипт, что в README; понадобится пароль root по SSH (не сохраняется). Альтернатива — команда вручную по SSH.";
      warpActionsEl.appendChild(sshHint);
    }

    const hint = document.createElement("p");
    hint.className = "muted warp-muted";
    hint.innerHTML =
      "Вручную на хосте (root), из каталога репозитория: <code class=\"inline\">bash scripts/warp-amnezia.sh install</code> или с именем контейнера: <code class=\"inline\">bash scripts/warp-amnezia.sh install amnezia-awg</code>.";
    warpActionsEl.appendChild(hint);

    if (!w.hostSshInstall) {
      const noBtn = document.createElement("p");
      noBtn.className = "muted warp-muted";
      noBtn.textContent =
        "Кнопка установки с панели недоступна: нет sshpass в образе панели или включено TIME_SYNC_DISABLED=1 — используйте SSH вручную.";
      warpActionsEl.appendChild(noBtn);
    }

    const skip = document.createElement("p");
    skip.className = "muted warp-muted";
    skip.textContent = "Если выход через Cloudflare не нужен, ничего не нажимайте — VPN уже работает без этого блока.";
    warpActionsEl.appendChild(skip);
    return;
  }

  const parts = [];
  parts.push(w.running ? "Интерфейс warp поднят" : "Интерфейс warp опущен");
  if (w.exitIp) parts.push(`выход ${w.exitIp}`);
  warpStatusLine.textContent = parts.join(" · ");

  const selection = new Set((w.selectedAllowedIps || []).map(String));
  const validWarpPeerIps = new Set();
  for (const c of data.clients) {
    if (!c.activeInConf) continue;
    parseIpv4Cidrs(c.allowedIps).forEach((ip) => validWarpPeerIps.add(ip));
  }
  for (const ip of [...selection]) {
    if (!validWarpPeerIps.has(ip)) selection.delete(ip);
  }

  function redrawChecks() {
    warpClientListEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    let any = false;
    for (const c of data.clients) {
      if (!c.activeInConf) continue;
      const ips = parseIpv4Cidrs(c.allowedIps);
      if (!ips.length) continue;
      any = true;
      const ip = ips[0];
      const label = document.createElement("label");
      label.className = "warp-check-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selection.has(ip);
      cb.addEventListener("change", () => {
        if (cb.checked) selection.add(ip);
        else selection.delete(ip);
      });
      const span = document.createElement("span");
      span.textContent = `${c.name} · ${ip}`;
      label.append(cb, span);
      frag.appendChild(label);
    }
    warpClientListEl.appendChild(frag);
    if (!any) {
      const p = document.createElement("p");
      p.className = "muted warp-muted";
      p.textContent =
        "Нет активных клиентов с IPv4 AllowedIPs (/32) — WARP-политика в вебе работает только для таких адресов.";
      warpClientListEl.appendChild(p);
    }
  }

  redrawChecks();

  warpActionsEl.appendChild(
    btn("Поднять WARP", "btn small primary", async () => {
      try {
        setStatus("Поднимаю WARP…", false);
        await api("/api/warp/start", { method: "POST", body: JSON.stringify({}) });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Остановить WARP", "btn small ghost", async () => {
      try {
        setStatus("Останавливаю WARP…", false);
        await api("/api/warp/stop", { method: "POST", body: JSON.stringify({}) });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Все в WARP", "btn small ghost", () => {
      for (const c of data.clients) {
        if (!c.activeInConf) continue;
        parseIpv4Cidrs(c.allowedIps).forEach((ip) => selection.add(ip));
      }
      redrawChecks();
    }),
  );
  warpActionsEl.appendChild(
    btn("Никого", "btn small ghost", () => {
      selection.clear();
      redrawChecks();
    }),
  );
  warpActionsEl.appendChild(
    btn("Применить маршрутизацию", "btn small primary", async () => {
      try {
        setStatus("Сохраняю WARP и перезапускаю контейнер AWG…", false);
        await api("/api/warp/routing", {
          method: "POST",
          body: JSON.stringify({ selectedAllowedIps: [...selection] }),
        });
        setStatus("Готово.", false);
        await loadClients();
      } catch (e) {
        setStatus(String(e.message || e), true);
      }
    }),
  );
  warpActionsEl.appendChild(
    btn("Удалить WARP с VPS", "btn small warn", () => openWarpHostSetup("uninstall")),
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentProfileIdValue() {
  if (!protoSelect || !protoSwitch || protoSwitch.classList.contains("hidden")) return "";
  return String(protoSelect.value || "").trim();
}

/** Query для нужного инстанса при нескольких профилях AWG_PROFILES */
function currentProfileQuerySuffix() {
  const pid = currentProfileIdValue();
  return pid ? `&profileId=${encodeURIComponent(pid)}` : "";
}

/** Прямая GET-ссылка на скачивание (работает в браузере с активной сессией панели). */
function clientExportGetUrl(clientId) {
  const q = `clientId=${encodeURIComponent(clientId)}${currentProfileQuerySuffix()}`;
  return `${window.location.origin}/api/clients/export-config?${q}`;
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

async function downloadClientConfig(c) {
  try {
    setStatus("Готовлю конфиг…", false);
    const res = await fetch(clientExportGetUrl(c.clientId), {
      method: "GET",
      credentials: "same-origin",
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = typeof j.error === "string" ? j.error : msg;
      } catch {
        /* сырой текст */
      }
      throw new Error(msg);
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = String(c.name || "client")
      .replace(/[^\w\u0400-\u04FF\-]+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `amnezia-${safe}.conf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Конфиг скачан.", false);
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function downloadCascadeConf(ev) {
  ev.preventDefault();
  const endpointEl = document.querySelector("#cascade-endpoint");
  const portEl = document.querySelector("#cascade-port");
  const tunnelEl = document.querySelector("#cascade-tunnel-ip");
  const nameEl = document.querySelector("#cascade-name");
  const endpointHost = endpointEl?.value.trim() || "";
  if (!endpointHost) {
    setStatus("Укажите Endpoint (IP или DNS для клиента в каскаде).", true);
    return;
  }
  const body = { endpointHost };
  const praw = portEl?.value.trim() ?? "";
  if (praw) {
    const n = Number(praw);
    if (!Number.isFinite(n) || n < 1 || n > 65535) {
      setStatus("Некорректный порт Endpoint (1–65535).", true);
      return;
    }
    body.endpointPort = n;
  }
  const tip = tunnelEl?.value.trim();
  if (tip) body.tunnelIp = tip;
  const nm = nameEl?.value.trim();
  if (nm) body.clientName = nm;
  const pid = currentProfileIdValue();
  if (pid) body.profileId = pid;
  try {
    setStatus("Создаю клиента на сервере и собираю .conf…", false);
    const res = await fetch("/api/clients/create-cascade", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = typeof j.error === "string" ? j.error : msg;
      } catch {
        /* raw */
      }
      throw new Error(msg);
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (nm || "cascade")
      .replace(/[^\w\u0400-\u04FF\-]+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `amnezia-cascade-${safe}.conf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Клиент добавлен на сервер, .conf скачан. Обновите таблицу.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function downloadDirectConf(ev) {
  ev.preventDefault();
  const nameEl = document.querySelector("#direct-name");
  const tunnelEl = document.querySelector("#direct-tunnel-ip");
  const body = {};
  const nm = nameEl?.value.trim();
  if (nm) body.clientName = nm;
  const tip = tunnelEl?.value.trim();
  if (tip) body.tunnelIp = tip;
  const pid = currentProfileIdValue();
  if (pid) body.profileId = pid;
  try {
    setStatus("Создаю клиента на сервере и собираю .conf…", false);
    const res = await fetch("/api/clients/create", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = typeof j.error === "string" ? j.error : msg;
      } catch {
        /* raw */
      }
      throw new Error(msg);
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (nm || "client")
      .replace(/[^\w\u0400-\u04FF\-]+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `amnezia-${safe}.conf`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (nameEl) nameEl.value = "";
    if (tunnelEl) tunnelEl.value = "";
    setStatus("Клиент добавлен на сервер, .conf скачан. Обновите таблицу.", false);
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

const VARIANT_META = {
  awg2: { icon: "✨", title: "AmneziaWG 2.0", badge: "NEW" },
  awg: { icon: "🔮", title: "AmneziaWG", badge: "" },
  legacy: { icon: "📡", title: "AmneziaWG Legacy", badge: "" },
};

async function loadInstances() {
  const grid = document.querySelector("#instances-grid");
  if (!grid) return;
  let data;
  try {
    data = await api("/api/instances");
  } catch (e) {
    grid.innerHTML = `<div class="muted">Не удалось загрузить инстансы: ${escapeHtmlSafe(String(e.message || e))}</div>`;
    return;
  }
  const list = data.instances || [];
  if (!list.length) {
    grid.innerHTML = `<div class="muted instance-empty">Нет развёрнутых инстансов. Создайте первый формой ниже.</div>`;
    return;
  }
  grid.innerHTML = list.map((i) => {
    const m = VARIANT_META[i.variant] || { icon: "🛡", title: i.variant, badge: "" };
    const status = i.running
      ? `<span class="inst-status on">● РАБОТАЕТ</span>`
      : `<span class="inst-status off">● ОСТАНОВЛЕН</span>`;
    const toggle = i.running
      ? `<button class="btn small ghost" data-act="stop" data-id="${i.id}">■ Стоп</button>`
      : `<button class="btn small primary" data-act="start" data-id="${i.id}">▶ Старт</button>`;
    const badge = m.badge ? `<span class="inst-badge">${m.badge}</span>` : "";
    return `<div class="inst-card">
      <div class="inst-card-head">
        <div class="inst-ico">${m.icon}</div>
        ${toggle}
      </div>
      <div class="inst-title">${escapeHtmlSafe(m.title)} ${badge}</div>
      <div class="inst-desc muted">${escapeHtmlSafe(i.variantMeta?.desc || "")}</div>
      <div class="inst-status-row">${status}</div>
      <div class="inst-stats">
        <div><span class="inst-stat-l">ПОРТ</span><span class="inst-stat-v">${i.port || "?"}/UDP</span></div>
        <div><span class="inst-stat-l">ПОДКЛЮЧЕНИЯ</span><span class="inst-stat-v">${i.peers == null ? "—" : i.peers}</span></div>
      </div>
      <div class="inst-actions">
        <button class="btn small ghost" data-act="use" data-id="${i.id}">Подключения</button>
        <button class="btn small warn" data-act="delete" data-id="${i.id}" data-label="${escapeHtmlSafe(m.title)}">Удалить</button>
      </div>
    </div>`;
  }).join("");

  grid.querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => void instanceAction(b.dataset.act, b.dataset.id, b.dataset.label));
  });
}

function escapeHtmlSafe(x) {
  return String(x == null ? "" : x).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function instanceAction(act, id, label) {
  try {
    if (act === "stop") { await api("/api/instances/stop", { method: "POST", body: JSON.stringify({ id }) }); setStatus("Инстанс остановлен.", false); }
    else if (act === "start") { await api("/api/instances/start", { method: "POST", body: JSON.stringify({ id }) }); setStatus("Инстанс запущен.", false); }
    else if (act === "delete") {
      if (!confirm(`Удалить инстанс «${label || id}» (${id}) вместе со всеми клиентами на нём?`)) return;
      await api("/api/instances/delete", { method: "POST", body: JSON.stringify({ id }) });
      setStatus("Инстанс удалён.", false);
    } else if (act === "use") {
      const sel = document.querySelector("#proto-select");
      if (sel) { sel.value = id; sel.dispatchEvent(new Event("change")); }
      document.querySelector("#users-panel")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    await loadInstances();
    await loadClients();
  } catch (e) {
    setStatus(String(e.message || e), true);
  }
}

async function createInstance(ev) {
  ev.preventDefault();
  const variant = document.querySelector("#instance-variant")?.value;
  const port = Number(document.querySelector("#instance-port")?.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { setStatus("Укажите корректный порт (1–65535).", true); return; }
  const btn = ev.target.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Разворачиваю… (до минуты)"; }
  try {
    await api("/api/instances/create", { method: "POST", body: JSON.stringify({ variant, port }) });
    setStatus("Инстанс развёрнут.", false);
    const pe = document.querySelector("#instance-port"); if (pe) pe.value = "";
    await loadInstances();
  } catch (e) {
    setStatus(String(e.message || e), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "＋ Развернуть инстанс"; }
  }
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
    applyEditionPayload(data);
    applyUiHiddenFromPayload(data);
    const pref = data.profileLabel ? `${data.profileLabel} · ` : "";
    if (uiHidden.users) {
      peerCountEl.textContent = "";
      wgShowEl.textContent = "";
    } else {
      peerCountEl.textContent = `${pref}${data.clients.length} в таблице · ${data.peerCount} peer`;
      wgShowEl.textContent = data.wgShow || "";
    }
    renderWarpPanel(data);
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
    if (warpPanel) warpPanel.hidden = true;
    if (mtprotoPanel) mtprotoPanel.hidden = true;
  }
}

function initMtprotoLinkCopy() {
  if (!mtprotoLinkCopyBtn) return;
  mtprotoLinkCopyBtn.addEventListener("click", async () => {
    const link =
      mtprotoLinkCardEl?.dataset?.tgLink ||
      mtprotoLinkAnchorEl?.href ||
      "";
    if (!link) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (mtprotoLinkCopyState) {
        mtprotoLinkCopyState.textContent = "Скопировано";
        setTimeout(() => {
          if (mtprotoLinkCopyState) mtprotoLinkCopyState.textContent = "";
        }, 2400);
      }
    } catch {
      if (mtprotoLinkCopyState) {
        mtprotoLinkCopyState.textContent = "Не удалось скопировать — выделите вручную.";
      }
    }
  });
}

async function boot() {
  const ok = await checkSession();
  if (ok) {
    showApp();
    await loadProtocols();
    await loadTimeSyncCaps();
    await loadClients();
    await loadInstances();
  } else {
    showLogin();
    loginPassword.focus();
  }
}

initMtprotoLinkCopy();
boot();
