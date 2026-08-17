// node scripts/test-clients-meta.mjs — самопроверка страховки clientsTable
import assert from "assert";
import { healClientsMeta, isPlaceholderName } from "./clients-meta.mjs";

const good = [
  {
    clientId: "A=",
    userData: {
      clientName: "Mama",
      creationDate: "Sat Jun 27 2026",
      last_config: "{...}",
      lastDisconnectedAt: "2027-05-06T10:00:00.000Z",
    },
  },
  { clientId: "B=", userData: { clientName: "teplici", creationDate: "Sat Jul 04 2026" } },
];

// 1. Снимок берёт живые значения.
const snap = healClientsMeta(good, {});
assert.equal(snap.restored, 0);
assert.equal(snap.meta["A="].clientName, "Mama");
assert.equal(snap.metaChanged, true);

// 2. Приложение затёрло таблицу — имена и даты возвращаются, новый клиент не трогается.
const wiped = [
  { clientId: "A=", userData: { clientName: "Client 0" } },
  { clientId: "B=", userData: { clientName: "Client 1" } },
  { clientId: "C=", userData: { clientName: "Client 2" } },
];
const fixed = healClientsMeta(wiped, snap.meta);
assert.equal(fixed.clients[0].userData.clientName, "Mama");
assert.equal(fixed.clients[0].userData.last_config, "{...}");
assert.equal(fixed.clients[0].userData.lastDisconnectedAt, "2027-05-06T10:00:00.000Z");
assert.equal(fixed.clients[1].userData.creationDate, "Sat Jul 04 2026");
assert.equal(fixed.clients[2].userData.clientName, "Client 2");
assert.equal(fixed.restored, 6);

// 2б. Дату сняли в панели (запись целая) — снимок её не воскрешает и забывает.
const cleared = healClientsMeta(
  [{ clientId: "A=", userData: { clientName: "Mama", creationDate: "Sat Jun 27 2026", last_config: "{...}" } }],
  snap.meta
);
assert.equal(cleared.clients[0].userData.lastDisconnectedAt, undefined);
assert.equal(cleared.meta["A="].lastDisconnectedAt, undefined);

// 3. Повторный прогон уже целой таблицы ничего не чинит и не переписывает снимок.
const again = healClientsMeta(fixed.clients, fixed.meta);
assert.equal(again.restored, 0);
assert.equal(again.metaChanged, false);

// 4. Переименование в панели побеждает старый снимок.
const renamed = healClientsMeta(
  [{ clientId: "A=", userData: { clientName: "Мама новая" } }],
  snap.meta
);
assert.equal(renamed.clients[0].userData.clientName, "Мама новая");
assert.equal(renamed.meta["A="].clientName, "Мама новая");

assert.ok(isPlaceholderName("Client 17") && !isPlaceholderName("Vorot2"));
console.log("clients-meta: ok");
