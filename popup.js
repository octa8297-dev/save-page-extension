/*
 * popup.js — интерфейс расширения.
 *
 * Роль popup минимальна:
 *   - инжектит content.js в активную вкладку;
 *   - отправляет команду (действие + настройки) через Port;
 *   - показывает статус;
 *   - кладёт данные в буфер обмена (clipboard API требует контекст
 *     с пользовательским жестом, поэтому это делается здесь, а не в content.js).
 *
 * Файлы скачиваются внутри content.js — popup их не трогает.
 * Работает и в Firefox (browser.*), и в Chromium (chrome.*).
 */

// ─── Ссылка для кнопки «Поддержать разработку» ───────────────────────────
// Впишите сюда адрес своей страницы поддержки (Boosty, Ko-fi, Buy Me a Coffee
// и т. п.). Пока строка пустая, кнопка не показывается.
const DONATE_URL = "https://boosty.to/pagesaver/donate";
// ─────────────────────────────────────────────────────────────────────────

const api = typeof browser !== "undefined" ? browser : chrome;

const statusEl    = document.getElementById("status");
const chkScroll   = document.getElementById("chkScroll");
const chkEmbed    = document.getElementById("chkEmbed");
const speedSlider = document.getElementById("speedSlider");
const speedLabel  = document.getElementById("speedLabel");
const donateBtn   = document.getElementById("donate");

// Прямое сохранение в PDF идёт через tabs.saveAsPDF() в фоновом скрипте.
// Это API есть только в Firefox, и в сборке для Chromium фонового скрипта нет,
// поэтому кнопку там просто не показываем — остаётся «PDF через печать».
const HAS_DIRECT_PDF = !!(api.runtime.getManifest().background);
if (!HAS_DIRECT_PDF) {
  const b = document.getElementById("btnPdfDirect");
  if (b) b.remove();
}

if (DONATE_URL) {
  donateBtn.style.display = "block";
  donateBtn.addEventListener("click", () => api.tabs.create({ url: DONATE_URL }));
}

// Пресеты: [stepPct, pauseMs, label]
const SPEED_PRESETS = [
  [0.40, 100, "Тщательно"],
  [0.65,  40, "Обычный"],
  [0.90,  20, "Быстро"]
];

speedSlider.addEventListener("input", () => {
  speedLabel.textContent = SPEED_PRESETS[speedSlider.value][2];
});

function getSpeedParams() {
  const p = SPEED_PRESETS[speedSlider.value];
  return { stepPct: p[0], pauseMs: p[1] };
}

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || "";
}

function lockUI(yes) {
  document.querySelectorAll("button[data-action]").forEach(b => b.disabled = yes);
}

// ===== Получить вкладку =====
async function getTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const t = tabs && tabs[0];
  if (!t || !t.id) throw new Error("Нет активной вкладки");
  // Служебные страницы браузеров, куда скрипт не инжектится.
  // У каждого движка своя схема: Yandex и Vivaldi используют browser:// и
  // vivaldi://, поэтому одной проверки на chrome:// недостаточно.
  const SERVICE_PAGE = /^(about:|moz-extension:|chrome:|chrome-extension:|extension:|edge:|opera:|brave:|browser:|vivaldi:|yandex:|devtools:|view-source:)/i;
  if (SERVICE_PAGE.test(t.url || ""))
    throw new Error("Расширение не работает на служебных страницах. Откройте обычный сайт.");
  return t;
}

// ===== Инжект + Port =====
function execute(tabId, action) {
  return new Promise(async (resolve, reject) => {
    // 1. Инжектим content.js
    try {
      await api.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
    } catch (e) {
      return reject(new Error(
        "Не удалось запустить скрипт на этой странице.\n" + (e.message || e)
      ));
    }

    // 2. Подключаем Port
    let port;
    try {
      port = api.tabs.connect(tabId, { name: "pageSaver" });
    } catch (e) {
      return reject(new Error("Не удалось подключиться: " + (e.message || e)));
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { port.disconnect(); } catch (e) {}
      reject(new Error("Превышено время ожидания (5 мин). Попробуйте без прокрутки."));
    }, 5 * 60 * 1000);

    function finish(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch (e) {}
      fn(val);
    }

    port.onMessage.addListener(msg => {
      switch (msg.type) {
        case "progress":
          setStatus(msg.text || "Работаю…");
          break;
        case "done":
          finish(resolve, { ok: true, text: msg.text });
          break;
        case "error":
          finish(reject, new Error(msg.text || "Ошибка в content.js"));
          break;
        // Для буфера обмена: content.js отправляет данные сюда
        case "clipboard":
          // msg.text = plain text
          navigator.clipboard.writeText(msg.text).then(
            () => finish(resolve, { ok: true, text: "✅ Текст скопирован! Вставьте в Word (Ctrl+V)." }),
            (e) => finish(reject, new Error("Не удалось скопировать: " + e.message))
          );
          break;
        case "clipboardData":
          // msg.text = plain, msg.html = rich html
          try {
            const htmlBlob = new Blob([msg.html], { type: "text/html" });
            const textBlob = new Blob([msg.text], { type: "text/plain" });
            navigator.clipboard.write([
              new ClipboardItem({ "text/html": htmlBlob, "text/plain": textBlob })
            ]).then(
              () => finish(resolve, { ok: true, text: "✅ Скопировано с форматированием!" }),
              (e) => {
                // Фолбэк: копируем хотя бы текст
                navigator.clipboard.writeText(msg.text).then(
                  () => finish(resolve, { ok: true, text: "✅ Скопирован текст (форматирование не поддерживается)." }),
                  () => finish(reject, new Error("Не удалось скопировать: " + e.message))
                );
              }
            );
          } catch (e) {
            // Старый Firefox без ClipboardItem
            navigator.clipboard.writeText(msg.text).then(
              () => finish(resolve, { ok: true, text: "✅ Скопирован текст (форматирование не поддерживается)." }),
              () => finish(reject, new Error("Не удалось скопировать"))
            );
          }
          break;
        // content.js не смог скачать картинку из-за CORS — качаем отсюда
        case "fetchImage":
          fetchImageAsDataUrl(msg.url).then(data => {
            try { port.postMessage({ type: "imageData", id: msg.id, data }); } catch (e) {}
          });
          break;
        // «PDF через печать»: window.open со страницы блокируется, открываем тут
        case "openPrint":
          openPrintTab(msg.html).then(
            tab => {
              finish(resolve, { ok: true, text: "✅ Открылось окно печати — выберите «Сохранить в PDF»." });
              // После переключения вкладки popup закроется — поэтому в самом конце
              api.tabs.update(tab.id, { active: true });
            },
            e => finish(reject, new Error("Не удалось открыть страницу для печати: " + (e.message || e)))
          );
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      // Если мы не завершились нормально — значит что-то оборвалось
      if (!settled) {
        finish(reject, new Error("Соединение оборвалось. Попробуйте ещё раз."));
      }
    });

    // 3. Отправляем команду
    try {
      port.postMessage({
        action: action,
        scroll: chkScroll.checked,
        embed: chkEmbed.checked,
        ...getSpeedParams()
      });
    } catch (e) {
      finish(reject, new Error("Не удалось отправить команду: " + (e.message || e)));
    }
  });
}

// ===== Картинка → data: URL (для встраивания) =====
async function fetchImageAsDataUrl(url) {
  try {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), 10000);
    const resp = await fetch(url, { signal: ac.signal, credentials: "include" });
    clearTimeout(tm);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (blob.size > 5e6 || !/^image\//i.test(blob.type)) return null;
    return await new Promise((ok, bad) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = bad;
      r.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

// ===== Вкладка для печати в PDF =====
// Документ открывается в фоне и активируется после загрузки: blob-адрес живёт,
// пока открыт popup, а popup закрывается, как только вкладка становится активной.
// print.js сам вызывает диалог печати, когда вкладка станет видимой.
async function openPrintTab(html) {
  const script = '<script src="' + api.runtime.getURL("print.js") + '"></script>';
  const i = html.lastIndexOf("</body>");
  const page = i >= 0 ? html.slice(0, i) + script + html.slice(i) : html + script;
  const url = URL.createObjectURL(new Blob([page], { type: "text/html;charset=utf-8" }));
  const tab = await api.tabs.create({ url, active: false });
  await new Promise(resolve => {
    const timer = setTimeout(done, 15000);
    function done() {
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(onUpd);
      resolve();
    }
    function onUpd(id, info) {
      if (id === tab.id && info.status === "complete") done();
    }
    api.tabs.onUpdated.addListener(onUpd);
    api.tabs.get(tab.id).then(t => { if (t.status === "complete") done(); }, () => {});
  });
  return tab;
}

// ===== Обработчик кнопок =====
async function handleClick(action) {
  lockUI(true);
  setStatus("Запускаю…");
  try {
    const tab = await getTab();
    const result = await execute(tab.id, action);
    setStatus(result.text || "✅ Готово!", "ok");
  } catch (e) {
    setStatus("❌ " + (e.message || e), "err");
  } finally {
    lockUI(false);
  }
}

document.querySelectorAll("button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => handleClick(btn.dataset.action));
});
