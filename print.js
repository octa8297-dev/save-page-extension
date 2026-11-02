/*
 * print.js — подключается к странице «PDF через печать» (её открывает popup.js).
 * Открывает диалог печати, как только вкладка загружена и видна: popup грузит
 * её в фоне, а print() в скрытой вкладке либо не сработает, либо уйдёт в никуда.
 */
(() => {
  let done = false;
  function go() {
    if (done || document.readyState !== "complete" || document.visibilityState !== "visible") return;
    done = true;
    setTimeout(() => window.print(), 300);
  }
  window.addEventListener("load", go);
  document.addEventListener("visibilitychange", go);
  go();
})();
