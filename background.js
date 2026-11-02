/*
 * background.js — прямое сохранение страницы в PDF.
 *
 * ТОЛЬКО ДЛЯ FIREFOX. Получает готовый HTML от content.js, открывает его во
 * временной вкладке, сохраняет её через tabs.saveAsPDF() и вкладку закрывает.
 *
 * tabs.saveAsPDF() — нестандартное API, его нет в Chrome, Edge и других
 * браузерах на Chromium. Поэтому в сборке для Chromium (manifest-chrome.json)
 * этот файл не подключается вовсе, кнопка «PDF сразу в файл» там не
 * показывается, а PDF сохраняется через диалог печати.
 */
const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "savePdfContent") {
    return savePdfFromHtml(msg.html);
  }
});

async function savePdfFromHtml(html) {
  if (!api.tabs || typeof api.tabs.saveAsPDF !== "function") {
    return { ok: false, reason: "tabs.saveAsPDF недоступен — работает только в Firefox." };
  }

  // 1. Открываем чистый HTML в новой вкладке
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);
  let tab;

  try {
    tab = await api.tabs.create({ url: blobUrl, active: true });

    // 2. Ждём полной загрузки вкладки
    await waitTabComplete(tab.id, 15000);

    // 3. Даём картинкам отрисоваться
    await sleep(1500);

    // 4. Сохраняем в PDF — появится диалог «Сохранить как»
    const status = await api.tabs.saveAsPDF({
      headerLeft:   "",
      headerCenter: "",
      headerRight:  "",
      footerLeft:   "",
      footerCenter: "",
      footerRight:  "",
      paperWidth:   8.27,
      paperHeight:  11.69,
      marginTop:    0.4,
      marginBottom: 0.4,
      marginLeft:   0.4,
      marginRight:  0.4,
      scaling:      0.9,
      shrinkToFit:  true
    });

    if (status === "saved" || status === "replaced") {
      return { ok: true, reason: status };
    } else {
      return { ok: false, reason: status }; // "canceled" или "not_saved"
    }
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  } finally {
    // 5. Закрываем временную вкладку
    if (tab && tab.id != null) {
      try { await api.tabs.remove(tab.id); } catch (e) {}
    }
    try { URL.revokeObjectURL(blobUrl); } catch (e) {}
  }
}

function waitTabComplete(tabId, timeout) {
  return new Promise(resolve => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      try { api.tabs.onUpdated.removeListener(listener); } catch (e) {}
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === "complete") finish();
    }
    api.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeout);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
