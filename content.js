/*
 * content.js v6.3
 *
 * Стратегия: innerText из скролл-контейнера (без сайдбара) + MutationObserver.
 * Observer ловит каждый элемент, который появляется в DOM при виртуальном
 * скроллинге, до того как он будет удалён. Это даёт ~100% покрытие.
 * HTML строится из текста через простой Markdown-парсер.
 * v6.2: настраиваемая скорость прокрутки (stepPct/pauseMs из popup).
 * v6.3: фильтрация UI-элементов (isUILine), лимит коротких строк, cleanupLines.
 * v6.5: фикс бага — <ol> закрывался как </ul>, сдвиг вправо в Word.
 * v6.6: защита от обрыва — стабильность 5×500мс + проверка роста текста +
 *        финальный контрольный проход с дочитыванием.
 * v6.7: агрессивный clickMore (все элементы, includes, aria-label, парные
 *        ключевые слова), тройной scroll-to-bottom, scroll event dispatch.
 * v6.8: ФИКС ОБРЫВА ХВОСТА — _seen Set заменён на _seenAt Map со скользящим
 *        окном. Повтор строки допускается, если прошло >max(200, N/2) строк.
 * v6.9: подтверждено на реальном чате — хвост ловится (577 строк, низ достигнут).
 *        Финальный захват с самого дна + тройной scroll-to-bottom. Диагностика убрана.
 * v7.0: ФИКС СКРЕМБЛИРОВАНИЯ — clickMore больше НЕ кликает «Load earlier/older/
 *        previous». Раньше это подгружало старые сообщения, которые дописывались
 *        в конец массива и погребали хвост (начало чата оказывалось в конце файла).
 * v7.1: ФИКС ПОВТОРА СЕРЕДИНЫ — скользящее окно (v6.8) откачено на глобальную
 *        дедупликацию. При повторной прокрутке через тот же участок середина чата
 *        дублировалась и погребала хвост. Глобальный _seen Set + агрессивный скролл
 *        (доходит до хвоста) = каждая уникальная строка один раз, хвост в конце.
 * v7.2: (откачено) дедупликация по позиции — порог нестабилен в длинных чатах.
 * v7.3: НАДЁЖНЫЙ ХВОСТ — глобальная дедупликация тела (чисто, без повтора
 *        середины) + «сырой проход» по последним ~6 экранам: собирает последний
 *        обмен «You said:…» целиком сырьём (минуя _seen) и дописывает в конец со
 *        склейкой шва. Файл заканчивается ровно там, где заканчивается чат, даже
 *        если хвост — повторный показ ранее показанного блока.
 * v7.4: MARKDOWN С ФОРМАТИРОВАНИЕМ — параллельный захват HTML сообщений (по
 *        селекторам data-testid/data-message-author-role) + HTML→Markdown
 *        конвертер (**жирный**, *курсив*, `код`, ссылки, таблицы, блоки кода
 *        с языком, списки, цитаты). Новая кнопка «Markdown (.md)» в popup.
 * v7.5: СЕЛЕКТОРЫ ПОД РЕАЛЬНЫЙ claude.ai (из диагностики живого DOM):
 *        сообщения = [data-testid="transcript-row"], юзер = [data-cds="UserMessage"],
 *        ответ Claude = .font-claude-response → .prose. Конвертер фильтрует
 *        служебный UI (data-cds Icon/Button/Badge, tool-status, sr-only, вложения).
 *        Форматирование (<strong>×42, <code>×116, <table>×2) восстанавливается.
 * v7.6: ВЛОЖЕНИЯ + ХВОСТ В .md. Имена приложенных файлов (📎 `file.zip`) вместо
 *        выброса. Дедупликация HTML-сообщений теперь по позиции прокрутки —
 *        повторный показ (хвост) сохраняется и в Markdown, как в .txt.
 * v7.7: ФИКС ДУБЛЕЙ В .md. Позиционная дедупликация (v7.6) плодила дубли середины
 *        (нестабильный scrollHeight) — 50 вопросов вместо 18. Возврат к глобальной
 *        дедупликации сообщений + отдельное appendTailMessage() восстанавливает
 *        последнее сообщение у дна. Как в .txt-треке (v7.3): чисто + полный хвост.
 * v7.8: appendTailMessage добавляет только сообщения ПОСЛЕ последнего захваченного
 *        (ищет его среди нижних строк транскрипта), убирая лишние 2 дубля из v7.7.
 * v7.9: appendTailMessage останавливается на границе следующего обмена (первый
 *        вопрос юзера после хвоста). Не прихватывает старый обмен, который
 *        claude.ai рендерит ниже повторного показа. Хвост = ровно ответ на
 *        последний вопрос.
 * v7.10: ФИКС ОГРЫЗКОВ-ВЛОЖЕНИЙ. Имя приложенного файла в innerText затеняло текст
 *        вопроса → полное сообщение и неполный рендер (только файл) выглядели по-
 *        разному. Теперь подпись строится по «ядру» текста без имён вложений, а
 *        пост-фильтр в buildMarkdown убирает огрызки при наличии полной версии.
 * v7.11: ЕДИНАЯ ФИНАЛЬНАЯ ДЕДУПЛИКАЦИЯ. Три частичных механизма (ранний ключ,
 *        пост-фильтр огрызков, appendTailMessage) конфликтовали → дубли середины
 *        (#29/#31) проскакивали. Вся логика собрана в одну пост-обработку в
 *        buildMarkdown: огрызки убраны, тело дедуплицировано по ядру глобально,
 *        хвост (tail:true) сохранён отдельно и не дублирует конец тела.
 * v7.12: ПОДДЕРЖКА GOOGLE GEMINI (по правкам пользователя, перенесены в v7.11+):
 *        - сообщения = <user-query>/<model-response>, тело = .query-text/.markdown;
 *        - clickMore разворачивает свёрнутые запросы (.luminous-collapsed, кнопки
 *          «Развернуть»/«Expand»); appendRawTail знает русские/англ. маркеры Gemini.
 *        Разбор роли вынесен в общий parseRow() для Claude и Gemini.
 * v7.13: ФИКСЫ GEMINI по реальному .md: (1) ассистент подписывается по платформе
 *        (🤖 Gemini/ChatGPT/Claude); (2) убран дубль текста запроса (sr-заголовок
 *        «Ваш запрос» фильтруется, тело берётся из .query-text-line); (3) ложный
 *        хвост — appendTailMessage добавляет ТОЛЬКО если граница обмена надёжно
 *        найдена, иначе ничего (хвост уже в теле).
 * v7.14: ФИКС \b + СКОРОСТЬ. (1) Регекс «ваш запрос\b» не работал — \b не ставит
 *        границу после кириллицы в JS; убран \b, фильтр «Ваш запрос» заработал.
 *        (2) Ускорение ~2×: урезаны раздутые финальные проверки (тройной scroll
 *        1500→600мс, clickMore 4000→2000мс с ранним выходом), паузы основного
 *        цикла (3000→1500, 500→350), сырой проход хвоста (6→4 экрана, 140→90мс),
 *        быстрее пресеты скорости. Фиксированные паузы 14.4с→7.3с.
 * v7.15: ФИКС НЕПОЛНЫХ ОТВЕТОВ В .md. Ответ Claude разбит на несколько блоков
 *        .prose (сегменты между вызовами инструментов). Код брал только ПЕРВЫЙ
 *        блок, теряя всё после первого инструмента (покрытие .md падало до ~29%).
 *        Теперь mergeBlocks() собирает ВСЕ .prose (и .markdown для Gemini).
 * v7.16: goTop() в конце сделан опциональным (msg.scrollBackTop, по умолчанию
 *        выкл). Возврат в начало страницы к сохранению не относится — захват уже
 *        завершён. Теперь расширение остаётся там, где был пользователь.
 * v7.17: ЗАЩИТА ОТ КЛИКА ПО ВЛОЖЕНИЯМ. Пользователь заметил: clickMore мог
 *        активировать карточку файла (напр. «Firefox page saver.zip») → откроется
 *        превью и сохранение сломается. Добавлен isDangerous() — не кликаем
 *        вложения (data-cds Attachment/Card/File), артефакты, <a download>,
 *        ссылки/title с расширениями файлов. Кнопки «Load more» не задеты.
 * v7.18: ПЕРЕХОД НАВЕРХ ПЕРЕД ЗАХВАТОМ. Если «Сохранить» нажато в КОНЦЕ чата,
 *        расширение застревало у дна. Теперь в начале autoScroll — goTop() +
 *        догрузка верха, захват всегда идёт сверху вниз.
 * v7.19: ФИКС АКТИВАЦИИ ВЛОЖЕНИЯ У ДНА. Несмотря на isDangerous, clickMore у дна
 *        всё равно активировал ZIP-карточку (клик по обёртке/кнопке рядом).
 *        Решение: (1) clickMore ПОЛНОСТЬЮ отключён на claude.ai/Gemini/ChatGPT —
 *        там нет пагинации, прокрутки достаточно; для Gemini оставлено только
 *        разворачивание свёрнутых запросов. (2) isDangerous усилен: closest()+
 *        querySelector() по всем предкам/потомкам, бейджи-типы (ZIP/PDF…), имена
 *        файлов в тексте.
 * v7.20: ФИКС ПОТЕРИ ХВОСТА В .md. Финальный ответ Claude терялся, если граница
 *        не находилась в нижних строках. Fallback в appendTailMessage.
 * v7.21: appendTailMessage переписан надёжнее (окно 10 строк, чёткая логика хвоста
 *        + fallback на последний ответ ассистента). Диагностика подтвердила:
 *        хвост из DOM ловится; неполнота финального ответа = Claude ещё печатал
 *        на момент сохранения (гонка с генерацией, не баг захвата).
 * v7.22: ФИКС ПЕРЕПОЛНЕНИЯ КОДА. Блоки <pre> имели overflow-x:auto — в браузере
 *        горизонтальная прокрутка, но в PDF/печати длинные строки обрезались
 *        справа. Заменено на white-space:pre-wrap + word-break — длинные строки
 *        переносятся, видны в любом формате. Добавлены стили таблиц (рамки) для
 *        .doc/.html.
 * v7.23: КАРТИНКИ. Раньше HTML строился только из текста, и картинок в
 *        .doc/.html/PDF не было вовсе — галочка «Встроить картинки» ничего не
 *        делала. Теперь captureImages() запоминает картинки содержимого вместе с
 *        «якорем» (текстом перед ними), и они вставляются после этой строки.
 *        Встраивание: сначала fetch отсюда, при отказе (CORS) — через popup.
 *        Также: защита от параллельного запуска, PDF через печать открывается
 *        из popup (window.open без жеста блокируется), абсолютные ссылки в .md.
 */
(() => {
  if (window.__pageSaver6) return;
  window.__pageSaver6 = true;

  const api = typeof browser !== "undefined" ? browser : chrome;

  let _lines = [];
  let _seen = new Set();      // глобальная дедупликация тела чата
  let _container = null;

  // === v7.4: параллельный захват HTML-сообщений для восстановления форматирования ===
  let _htmlMessages = [];     // [{role: 'user'|'assistant', html: string, sig: string}]
  let _htmlSeen = new Set();  // подписи уже захваченных сообщений (глобальная дедуп)

  // === v7.23: картинки содержимого ===
  let _images = [];           // [{src, alt, anchor}] — anchor: текст перед картинкой
  let _imgSeen = new Set();

  // Popup закрывается от любого клика по странице, а прокрутка идёт минутами.
  // Повторный запуск поверх идущего сбросил бы общие массивы и испортил оба файла.
  let _busy = false;

  // Запросы картинок через popup (у него нет ограничений CORS страницы)
  let _imgReqId = 0;
  const _imgPending = new Map();

  api.runtime.onConnect.addListener(port => {
    if (port.name !== "pageSaver") return;
    port.onMessage.addListener(msg => {
      if (msg && msg.type === "imageData") {
        const cb = _imgPending.get(msg.id);
        if (cb) { _imgPending.delete(msg.id); cb(msg.data || null); }
        return;
      }
      if (_busy) {
        tell(port, "error", "На этой вкладке ещё идёт предыдущее сохранение — дождитесь его окончания.");
        return;
      }
      run(port, msg);
    });
  });

  function tell(port, type, text) {
    try { port.postMessage({ type, text }); } catch (e) {}
  }

  // ==================== ГЛАВНЫЙ ОБРАБОТЧИК ====================
  async function run(port, msg) {
    _busy = true;
    try {
      _lines = []; _seen = new Set(); _container = null;
      _htmlMessages = []; _htmlSeen = new Set();
      _images = []; _imgSeen = new Set();

      if (msg.scroll) {
        await autoScroll(port, msg);
      } else {
        _container = findScrollContainer();
        captureText();
      }

      tell(port, "progress", "Формирую документ…");
      const data = buildResult();

      if (!data.text) {
        tell(port, "error", "Страница пустая.");
        return;
      }

      let html = data.html;
      if (msg.embed && msg.action !== "copyText" && msg.action !== "saveTxt" && msg.action !== "saveMd") {
        html = await embedImages(html, port, (i, n) =>
          tell(port, "progress", "Картинки " + i + "/" + n + "…"));
      }

      const name = safeName(data.title);
      const a = msg.action;

      if (a === "copyText") {
        tell(port, "clipboard", data.text);
      } else if (a === "copyRich") {
        port.postMessage({ type: "clipboardData", text: data.text, html: wrap(data, html, "html") });
      } else if (a === "saveTxt") {
        dl(data.title+"\n"+data.url+"\n"+"=".repeat(50)+"\n\n"+data.text, "text/plain", name+".txt");
        tell(port, "done", "✅ .txt сохранён!");
      } else if (a === "saveMd") {
        if (!data.markdown || data.markdown.length < 20) {
          tell(port, "error", "Форматирование не удалось извлечь. Сохраните .txt как запасной вариант.");
        } else {
          dl(data.markdown, "text/markdown", name+".md");
          tell(port, "done", "✅ .md сохранён ("+(data.htmlMsgCount||0)+" сообщений с форматированием)!");
        }
      } else if (a === "inspectHtml") {
        // ДИАГНОСТИКА: сохраняем сырой HTML контейнера + анализ структуры
        const dump = inspectContainerHtml();
        dl(dump, "text/plain", name+"-inspect.txt");
        tell(port, "done", "✅ Диагностика сохранена — пришлите файл");
      } else if (a === "saveDoc") {
        dl(wrap(data, html, "word"), "application/msword", name+".doc");
        tell(port, "done", "✅ .doc сохранён!");
      } else if (a === "saveHtml") {
        dl(wrap(data, html, "html"), "text/html", name+".html");
        tell(port, "done", "✅ .html сохранён!");
      } else if (a === "savePdfDirect") {
        // Прямое сохранение в PDF работает через tabs.saveAsPDF() — это API есть
        // только в Firefox, и вызывается оно из фонового скрипта. В сборке для
        // Chromium фонового скрипта нет, поэтому запрос просто не дойдёт —
        // в этом случае честно говорим, какой кнопкой пользоваться.
        tell(port, "progress", "Сохраняю PDF…");
        let r = null;
        try {
          r = await api.runtime.sendMessage({type:"savePdfContent",html:wrap(data,html,"print")});
        } catch (e) { r = null; }
        if (r && r.ok) {
          tell(port, "done", "✅ PDF сохранён!");
        } else if (r && r.reason) {
          tell(port, "error", "Ошибка: " + r.reason);
        } else {
          tell(port, "error", "В этом браузере прямое сохранение PDF недоступно — нажмите «PDF через печать».");
        }
      } else if (a === "savePdfPrint") {
        // window.open отсюда после долгой прокрутки блокируется как всплывающее
        // окно (жеста пользователя уже нет). Поэтому вкладку открывает popup
        // через tabs.create — он же и сообщает результат.
        const page = wrap(data, html, "print");
        try {
          port.postMessage({ type: "openPrint", html: page });
        } catch (e) {
          // Popup уже закрыт — пробуем сами, вдруг всплывающие окна разрешены
          const u = URL.createObjectURL(new Blob([page],{type:"text/html;charset=utf-8"}));
          window.open(u,"_blank");
          setTimeout(()=>URL.revokeObjectURL(u),120000);
        }
      }
    } catch (e) {
      tell(port, "error", String(e&&e.message?e.message:e));
    } finally {
      _busy = false;
    }
  }

  function dl(content,mime,filename) {
    const b = new Blob(["\ufeff"+content],{type:mime+";charset=utf-8"});
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href=u; a.download=filename;
    a.style.cssText="position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(a); a.click();
    setTimeout(()=>{try{document.body.removeChild(a)}catch(e){}URL.revokeObjectURL(u)},10000);
  }

  // ==================== СКРОЛЛ-КОНТЕЙНЕР ====================
  function findScrollContainer() {
    let best=null, bestGap=0;
    for (const el of document.querySelectorAll("*")) {
      try {
        const s=getComputedStyle(el);
        if(s.overflowY!=="auto"&&s.overflowY!=="scroll") continue;
        const gap=el.scrollHeight-el.clientHeight;
        if(gap>100&&gap>bestGap){bestGap=gap;best=el;}
      } catch(e){}
    }
    return best;
  }

  // ==================== ФИЛЬТРАЦИЯ UI-ЭЛЕМЕНТОВ ====================
  // Паттерны откалиброваны на реальном сохранении чата claude.ai
  const UI_SKIP = [
    // === Claude.ai UI (проверено на реальных данных) ===

    // Кнопки действий
    /^(copy|copied!?|copy code|copy to clipboard|download|download all)$/i,
    /^(скопировать|скопировано!?|скачать)$/i,
    /^(edit|edited|retry|regenerate|share|publish|preview|notify)$/i,
    /^(редактировать|повторить|поделиться|опубликовать)$/i,
    /^(show less|show more|view result|hide result|expand|collapse)$/i,
    /^(показать|скрыть|свернуть|развернуть|подробнее)$/i,
    /^(cancel|save|delete|remove|close|dismiss|undo)$/i,
    /^(отмена|сохранить|удалить|закрыть|отменить)$/i,
    /^(like|dislike|upvote|downvote|report|flag|bookmark)$/i,
    /^(new chat|новый чат|start new|clear|history|история)$/i,
    /^(send|submit|stop|отправить|стоп|остановить)$/i,
    /^load (later|earlier|more|previous|next) messages$/i,
    /^message collapsed$/i,
    /^quote,?\s*\d*\s*lines?$/i,
    /^want to be notified/i,

    // Thinking / статусы действий
    /^(thinking|analyzing|running|searching|generating|writing|reading)\.{0,3}$/i,
    /^thought for \d+s?$/i,
    /^(ran|viewed|read|searched|analyzed|edited|created)\b.{0,60}(files?|commands?|tools?|searches?|results?|notes?)$/i,
    /^used \d+ tools?$/i,
    /^(view|show) \d+ (lines?|more)$/i,

    // Бейджи файлов (Claude показывает расширение БОЛЬШИМИ буквами)
    /^(PY|TXT|BAT|CSV|JSON|JSONL|MD|HTML|CSS|JS|TS|JSX|TSX|JAVA|CPP|RS|GO|RB|SQL|SH|INI|CFG|YAML|YML|XML|PDF|DOC|DOCX|XLS|XLSX|PPT|PPTX|ZIP|TAR|GZ|EXE|DLL|SVG|PNG|JPG|GIF|WAV|MP3|MP4|LOG|DAT|BIN|BAK)$/,
    // Счётчики строк файлов: «62 lines», «148 lines»
    /^\d+ lines?$/i,

    // Подвал / плейсхолдеры
    /^write a message/i,
    /^claude is ai and can make mistakes/i,
    /^use the .+ arrow keys/i,
    /^type .+ to (search|filter|find)/i,

    // Метки моделей
    /^claude[\s-]*\d/i,
    /^(sonnet|opus|haiku)[\s.]*[\d.]/i,
    /^gpt-?\d/i,
    /^model:/i,

    // === Общие паттерны (другие SPA-сайты) ===

    // Временные метки (самостоятельные строки)
    /^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}(,?\s+\d{2,4})?$/i,
    /^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?(,?\s+\d{2,4})?$/i,
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/,
    /^(today|yesterday|вчера|сегодня)$/i,
    /^\d+\s+(seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago$/i,
    /^\d+\s+(секунд|минут|час\w*|дн\w*|недел\w*|месяц\w*)\s+назад$/i,

    // Одиночные символы, эмоджи, разделители, голые числа 1-999
    /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]{1,4}$/u,
    /^[.…·•─═—–\-_|/\\]{1,10}$/,
    /^\d{1,3}$/,

    // Навигация
    /^(home|back|next|previous|menu|settings|log\s?out|sign\s?out)$/i,
    /^(главная|назад|далее|меню|настройки|выйти)$/i,
    /^[←→↑↓◀▶▲▼❮❯«»]{1,3}$/,
  ];

  function isUILine(line) {
    if (line.length > 80) return false;
    for (const p of UI_SKIP) {
      if (p.test(line)) return true;
    }
    return false;
  }

  // ==================== ЗАХВАТ ТЕКСТА ====================
  function addLines(text) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (isUILine(line)) continue;
      // Глобальная дедупликация: каждая уникальная строка — один раз. Надёжно
      // убирает повтор середины при перепрокрутке. Хвост (повторный показ) при
      // этом теряется — его восстанавливает «сырой проход» в конце autoScroll.
      if (!_seen.has(line)) {
        _seen.add(line);
        _lines.push(line);
      }
    }
  }

  function captureText() {
    const src = _container || document.body;
    addLines(src.innerText || "");
    captureHtmlMessages(src);  // v7.4: параллельно захватываем HTML
    captureImages(src);        // v7.23: картинки с привязкой к тексту
  }

  // ==================== ЗАХВАТ КАРТИНОК (v7.23) ====================
  // innerText картинок не содержит, поэтому для каждой запоминаем «якорь» —
  // последний текст перед ней в DOM. При сборке HTML картинка встаёт после
  // строки, содержащей якорь. Иконки, аватары и кнопки отсекаются по размеру.
  const MAX_IMAGES = 300;

  function captureImages(root) {
    if (_images.length >= MAX_IMAGES) return;
    let imgs;
    try { imgs = root.querySelectorAll("img"); } catch(e) { return; }
    for (const img of imgs) {
      try {
        const src = img.currentSrc || img.src || "";
        if (!src || _imgSeen.has(src)) continue;
        if (!/^(https?:|data:image\/|blob:)/i.test(src)) continue;
        // Ещё не загружена (ленивая загрузка, заглушка) — поймаем на следующем шаге
        if (!img.complete || img.naturalWidth < 32 || img.naturalHeight < 32) continue;
        const r = img.getBoundingClientRect();
        if (r.width < 48 || r.height < 48) continue;
        if (img.closest('button, nav, header, footer, [role="button"], [aria-hidden="true"]')) continue;
        _imgSeen.add(src);
        _images.push({ src, alt: (img.getAttribute("alt") || "").trim(), anchor: prevTextAnchor(img, root) });
        if (_images.length >= MAX_IMAGES) return;
      } catch(e) {}
    }
  }

  function prevTextAnchor(el, root) {
    try {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      w.currentNode = el;
      for (let n, k = 0; (n = w.previousNode()) && k < 300; k++) {
        const p = n.parentElement;
        if (p && p.closest('script, style, noscript, button, .sr-only, [aria-hidden="true"]')) continue;
        const parts = (n.textContent || "").split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
        const t = parts.length ? parts[parts.length - 1] : "";
        if (t.length >= 3 && !isUILine(t)) return t.slice(-60);
      }
    } catch(e) {}
    return "";
  }

  // Вставляет картинки в список строк: объект {img, alt} после строки-якоря.
  // Текстовые форматы получают строки как раньше — это только для HTML.
  function withImages(lines) {
    if (!_images.length) return lines;
    const norm = lines.map(l => l.replace(/\s+/g, " "));
    const before = [], orphans = [];
    const after = new Map();
    let last = 0;
    for (const im of _images) {
      const item = { img: im.src, alt: im.alt };
      if (!im.anchor) { before.push(item); continue; }
      // Картинки захватываются примерно в порядке документа — ищем сперва
      // от предыдущей найденной позиции, чтобы короткий якорь не прилип к началу
      let idx = -1;
      for (let i = last; i < norm.length; i++) if (norm[i].includes(im.anchor)) { idx = i; break; }
      if (idx < 0) for (let i = 0; i < last; i++) if (norm[i].includes(im.anchor)) { idx = i; break; }
      if (idx < 0) { orphans.push(item); continue; }
      last = idx;
      if (!after.has(idx)) after.set(idx, []);
      after.get(idx).push(item);
    }
    const out = before.slice();
    lines.forEach((l, i) => { out.push(l); if (after.has(i)) out.push(...after.get(i)); });
    return out.concat(orphans);
  }

  // ==================== ДИАГНОСТИКА СТРУКТУРЫ (v7.4-inspect) ====================
  function inspectContainerHtml() {
    const out = [];
    const container = _container || document.body;
    out.push("=== ДИАГНОСТИКА СТРУКТУРЫ claude.ai ===\n");

    // 1. Какие теги форматирования вообще есть в контейнере?
    out.push("--- Теги форматирования в контейнере ---");
    for (const tag of ['strong','b','em','i','code','pre','table','a','blockquote','h1','h2','h3','ul','ol','li']) {
      let n = 0;
      try { n = container.querySelectorAll(tag).length; } catch(e){}
      out.push(`  <${tag}>: ${n}`);
    }
    out.push("");

    // 2. Какие data-атрибуты встречаются?
    out.push("--- data-* атрибуты (топ-20) ---");
    const dataAttrs = {};
    try {
      for (const el of container.querySelectorAll('*')) {
        for (const attr of el.attributes) {
          if (attr.name.startsWith('data-')) {
            const key = attr.name + '="' + attr.value.slice(0, 30) + '"';
            dataAttrs[key] = (dataAttrs[key] || 0) + 1;
          }
        }
      }
    } catch(e){}
    const sorted = Object.entries(dataAttrs).sort((a,b)=>b[1]-a[1]).slice(0, 20);
    for (const [k, v] of sorted) out.push(`  ${v}x  ${k}`);
    out.push("");

    // 3. Классы, содержащие message/turn/human/assistant/prose/font
    out.push("--- Классы с ключевыми словами (топ-25) ---");
    const classes = {};
    try {
      for (const el of container.querySelectorAll('*')) {
        const cls = (typeof el.className === 'string') ? el.className : '';
        if (/message|turn|human|assistant|prose|font-claude|whitespace/i.test(cls)) {
          for (const c of cls.split(/\s+/)) {
            if (c && /message|turn|human|assistant|prose|font-claude|whitespace/i.test(c))
              classes[c] = (classes[c] || 0) + 1;
          }
        }
      }
    } catch(e){}
    const sortedC = Object.entries(classes).sort((a,b)=>b[1]-a[1]).slice(0, 25);
    for (const [k, v] of sortedC) out.push(`  ${v}x  .${k}`);
    out.push("");

    // 4. Сырой outerHTML первого блока, похожего на сообщение
    out.push("--- Сырой HTML первых 2 блоков (обрезано до 3000 симв) ---");
    let samples = [];
    try {
      samples = Array.from(container.querySelectorAll('[class*="message"], [class*="prose"], [class*="turn"]'))
        .filter(el => el.innerText && el.innerText.trim().length > 30)
        .slice(0, 2);
    } catch(e){}
    if (samples.length === 0) {
      // fallback: любые div с существенным текстом
      try {
        samples = Array.from(container.querySelectorAll('div'))
          .filter(el => el.innerText && el.innerText.trim().length > 50 && el.children.length > 0)
          .slice(0, 2);
      } catch(e){}
    }
    samples.forEach((el, i) => {
      out.push(`\n### Блок ${i+1} (tag=${el.tagName}, class="${(typeof el.className==='string'?el.className:'').slice(0,80)}") ###`);
      out.push(el.outerHTML.slice(0, 3000));
    });

    return out.join("\n");
  }

  // ==================== ЗАХВАТ HTML-СООБЩЕНИЙ (v7.5) ====================
  // Структура claude.ai (из диагностики):
  //  - Каждое сообщение — контейнер [data-testid="transcript-row"] или .group/message-row
  //  - Юзер: содержит [data-cds="UserMessage"] и <h2 class="sr-only">You said: …</h2>
  //  - Ассистент: содержит .font-claude-response с .prose (внутри <strong>,<code>,<table>…)
  function captureHtmlMessages(container) {
    // Строки транскрипта — самый надёжный контейнер сообщения
    let rows = [];
    try {
      rows = Array.from(container.querySelectorAll('[data-testid="transcript-row"]'));
    } catch(e){}
    // Fallback на группы message-row
    if (rows.length === 0) {
      try {
        rows = Array.from(container.querySelectorAll('[class*="message-row"]'));
      } catch(e){}
    }
    // Google Gemini: сообщения — веб-компоненты <user-query>/<model-response>
    if (rows.length === 0) {
      try {
        rows = Array.from(container.querySelectorAll('user-query, model-response'));
      } catch(e){}
    }

    for (const row of rows) {
      // Определяем роль и тело сообщения (Claude или Gemini) через общий разбор
      const pr = parseRow(row);
      if (!pr) continue;  // неизвестный блок — пропускаем служебное
      const role = pr.role;
      const bodyEl = pr.bodyEl;

      const text = (bodyEl.innerText || "").trim();
      if (!text || text.length < 2) continue;

      // Для дедупликации строим «ядро» текста БЕЗ имён вложений: имя приложенного
      // файла попадает в innerText первым и затеняет реальный вопрос. Из-за этого
      // полное сообщение и его неполный рендер (только вложение) выглядят по-разному.
      const attachNames = [];
      try {
        for (const f of bodyEl.querySelectorAll('[data-cds="MessageAttachmentsFile"]')) {
          const linked = f.querySelector('[data-cds="CardLink"]');
          const nm = (linked && linked.getAttribute('title')) ||
                     (f.querySelector('.sr-only') && f.querySelector('.sr-only').textContent) || '';
          if (nm) attachNames.push(nm.trim());
        }
      } catch(e){}
      let core = text;
      for (const nm of attachNames) core = core.split(nm).join('');
      core = core.replace(/\s+/g, ' ').trim();
      const attachSig = attachNames.length ? role + '|@|' + attachNames.join(',') : '';

      // Ранняя дедупликация — только точные повторы (полный текст), чтобы не
      // копить память. Вся умная логика (огрызки, ядро, хвост) — в buildMarkdown.
      const key = role + '|' + text;
      if (_htmlSeen.has(key)) continue;
      _htmlSeen.add(key);

      _htmlMessages.push({ role, html: bodyEl.outerHTML, text, core, attachSig });
    }
  }

  // Разбирает строку транскрипта в {role, bodyEl}. Поддержка Claude и Gemini.
  function parseRow(row) {
    const tag = (row.tagName || '').toLowerCase();
    if (tag === 'user-query') {
      const b = row.querySelector('.query-text-line, .query-text, .user-query-container');
      return { role: 'user', bodyEl: b || row };
    }
    if (tag === 'model-response') {
      // Gemini: ответ может состоять из нескольких блоков — собираем все
      const blocks = row.querySelectorAll('.markdown, .model-response-text, message-content');
      return { role: 'assistant', bodyEl: mergeBlocks(blocks) || row };
    }
    const claudeBody = row.querySelector('.font-claude-response') || row.querySelector('[data-cds="Prose"]');
    const userBody = row.querySelector('[data-cds="UserMessage"]');
    if (claudeBody) {
      // ВАЖНО: ответ Claude разбит на НЕСКОЛЬКО блоков .prose (текстовые сегменты
      // между вызовами инструментов). Берём ВСЕ, иначе теряется всё после первого
      // инструмента. Если .prose нет — берём весь блок ответа.
      const proses = claudeBody.querySelectorAll('.prose');
      const merged = mergeBlocks(proses);
      return { role: 'assistant', bodyEl: merged || claudeBody };
    }
    if (userBody) return { role: 'user', bodyEl: userBody };
    return null;
  }

  // Объединяет несколько DOM-блоков в один контейнер (клоны), сохраняя порядок.
  // Возвращает null, если блоков нет.
  function mergeBlocks(nodeList) {
    if (!nodeList || nodeList.length === 0) return null;
    if (nodeList.length === 1) return nodeList[0];
    const wrap = document.createElement('div');
    for (const n of nodeList) {
      try { wrap.appendChild(n.cloneNode(true)); } catch(e){}
    }
    return wrap;
  }

  // Восстанавливает ХВОСТ чата в .md-трек: последний обмен, даже если это
  // повторный показ ранее показанного контента. Работает надёжно: берёт
  // последние строки транскрипта из DOM и дописывает те, которых ещё нет
  // в конце _htmlMessages (по подписи содержимого).
  function appendTailMessage(container) {
    try {
      let rows = Array.from(container.querySelectorAll('[data-testid="transcript-row"]'));
      if (rows.length === 0) rows = Array.from(container.querySelectorAll('[class*="message-row"]'));
      if (rows.length === 0) rows = Array.from(container.querySelectorAll('user-query, model-response'));
      if (rows.length === 0) return;

      // Разбираем последние строки транскрипта (расширенное окно).
      const parsed = [];
      for (const row of rows.slice(-10)) {
        const pr = parseRow(row);
        if (!pr) continue;
        const { role, bodyEl } = pr;
        const text = (bodyEl.innerText || "").trim();
        if (!text || text.length < 2) continue;
        // core без имён вложений
        const attachNames = [];
        try {
          for (const f of bodyEl.querySelectorAll('[data-cds="MessageAttachmentsFile"]')) {
            const linked = f.querySelector('[data-cds="CardLink"]');
            const nm = (linked && linked.getAttribute('title')) ||
                       (f.querySelector('.sr-only') && f.querySelector('.sr-only').textContent) || '';
            if (nm) attachNames.push(nm.trim());
          }
        } catch(e){}
        let core = text;
        for (const nm of attachNames) core = core.split(nm).join('');
        core = core.replace(/\s+/g, ' ').trim();
        const attachSig = attachNames.length ? role + '|@|' + attachNames.join(',') : '';
        parsed.push({ role, text, html: bodyEl.outerHTML, core, attachSig, tail: true });
      }
      if (parsed.length === 0) return;

      const sigOf = m => m.role + '|' + (m.core || m.text).slice(0, 80);

      // Подписи уже захваченных сообщений (для проверки «уже есть»).
      const capturedSigs = new Set(_htmlMessages.map(sigOf));
      const lastCapturedSig = _htmlMessages.length ? sigOf(_htmlMessages[_htmlMessages.length - 1]) : null;

      // Ищем в parsed позицию последнего захваченного сообщения. Всё, что ПОСЛЕ
      // него в транскрипте — это недостающий хвост.
      let startIdx = 0;
      if (lastCapturedSig) {
        for (let i = parsed.length - 1; i >= 0; i--) {
          if (sigOf(parsed[i]) === lastCapturedSig) { startIdx = i + 1; break; }
        }
      }

      // Добавляем хвост от startIdx до конца, останавливаясь на границе следующего
      // обмена (новый вопрос юзера ПОСЛЕ первого добавленного). Пропускаем то,
      // что уже есть в теле (защита от дубля).
      let added = 0;
      for (let i = startIdx; i < parsed.length; i++) {
        const m = parsed[i];
        if (m.role === 'user' && added > 0) break;  // начался следующий обмен
        const s = sigOf(m);
        // Не дублируем: если такое сообщение уже последнее в теле — пропуск.
        if (added === 0 && capturedSigs.has(s)) {
          // возможно это то же последнее сообщение — пропускаем, но продолжаем
          // искать реальный хвост после него
          continue;
        }
        _htmlMessages.push(m);
        added++;
      }

      // FALLBACK: если ничего не добавили (граница совпала с концом), но самый
      // последний ответ ассистента в DOM отличается от конца тела — добавим его.
      if (added === 0) {
        let lastAssistant = null;
        for (let i = parsed.length - 1; i >= 0; i--) {
          if (parsed[i].role === 'assistant') { lastAssistant = parsed[i]; break; }
        }
        if (lastAssistant) {
          const s = sigOf(lastAssistant);
          const inTailOfBody = _htmlMessages.slice(-3).some(m => sigOf(m) === s);
          if (!inTailOfBody) _htmlMessages.push(lastAssistant);
        }
      }
    } catch(e){}
  }

  // ==================== HTML → MARKDOWN КОНВЕРТЕР (v7.4) ====================
  // Обходит DOM-узлы и собирает Markdown с сохранением форматирования.
  function htmlToMarkdown(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return nodeToMd(doc.body).trim();
  }

  function nodeToMd(node, ctx) {
    ctx = ctx || { listDepth: 0, inPre: false };
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      // Внутри <pre> текст берётся как есть, иначе схлопываем пробелы
      let t = node.textContent || '';
      if (!ctx.inPre) t = t.replace(/\s+/g, ' ');
      return t;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    // Пропускаем невидимые/технические
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
    // Пропускаем кнопки/UI внутри сообщений (Copy, Retry и т.п.)
    if (tag === 'button') return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';

    // Gemini: служебный префикс «Ваш запрос»/«Your query» в заголовке запроса.
    // Заголовок содержит «Ваш запрос <текст>», а ниже дублируется чистый текст.
    // Убираем такой заголовок целиком (текст остаётся в дубле ниже).
    // ВНИМАНИЕ: \b не работает после кириллицы в JS — не используем.
    if (/^h[1-6]$/.test(tag)) {
      const htxt = (node.textContent || '').trim();
      if (/^(ваш запрос|your query|prompt|запрос)/i.test(htxt)) return '';
    }

    // Пропускаем служебные элементы claude.ai:
    const cds = node.getAttribute('data-cds') || '';
    const testid = node.getAttribute('data-testid') || '';
    const cls = (typeof node.className === 'string') ? node.className : '';
    //  - иконки, кнопки, статусы инструментов, действия сообщения
    if (cds === 'Icon' || cds === 'Button' || cds === 'MessageActions' || cds === 'Badge') return '';
    if (/tool-status|message-actions/i.test(testid)) return '';
    //  - sr-only (скрытые для скринридеров дубли-заголовки «You said:»)
    if (/\bsr-only\b/.test(cls)) return '';

    // Вложения: вместо полного выброса — извлекаем ИМЯ файла и тип.
    // Структура: [data-cds=MessageAttachments] > [data-cds=MessageAttachmentsFile] > … > [title="имя"]
    if (cds === 'MessageAttachments') {
      const names = [];
      try {
        for (const f of node.querySelectorAll('[data-cds="MessageAttachmentsFile"]')) {
          // Имя файла — в title у CardLink или в sr-only span
          let nm = '';
          const linked = f.querySelector('[data-cds="CardLink"]');
          if (linked && linked.getAttribute('title')) nm = linked.getAttribute('title');
          if (!nm) {
            const sr = f.querySelector('.sr-only, [title]');
            if (sr) nm = (sr.getAttribute && sr.getAttribute('title')) || sr.textContent || '';
          }
          nm = (nm || '').trim();
          if (nm) names.push(nm);
        }
      } catch(e){}
      if (names.length === 0) return '';
      // Оформляем как список приложенных файлов
      return '\n\n' + names.map(n => '📎 `' + n + '`').join('  ') + '\n\n';
    }
    if (cds === 'MessageAttachmentsFile') return '';  // обработано родителем

    const childrenMd = () => Array.from(node.childNodes).map(c => nodeToMd(c, ctx)).join('');

    switch (tag) {
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'p': return '\n\n' + childrenMd() + '\n\n';
      case 'h1': return '\n\n# ' + childrenMd().trim() + '\n\n';
      case 'h2': return '\n\n## ' + childrenMd().trim() + '\n\n';
      case 'h3': return '\n\n### ' + childrenMd().trim() + '\n\n';
      case 'h4': return '\n\n#### ' + childrenMd().trim() + '\n\n';
      case 'h5': return '\n\n##### ' + childrenMd().trim() + '\n\n';
      case 'h6': return '\n\n###### ' + childrenMd().trim() + '\n\n';

      case 'strong': case 'b': {
        const inner = childrenMd().trim();
        return inner ? '**' + inner + '**' : '';
      }
      case 'em': case 'i': {
        const inner = childrenMd().trim();
        return inner ? '*' + inner + '*' : '';
      }
      case 'del': case 's': case 'strike': {
        const inner = childrenMd().trim();
        return inner ? '~~' + inner + '~~' : '';
      }
      case 'u': return childrenMd();

      case 'code': {
        // Если внутри <pre> — не оборачиваем (обёрнет <pre>)
        if (ctx.inPre) return childrenMd();
        const inner = (node.textContent || '').replace(/\n/g, ' ');
        if (!inner) return '';
        // Если внутри кода есть обратные кавычки — используем двойные
        return inner.includes('`') ? '``' + inner + '``' : '`' + inner + '`';
      }
      case 'pre': {
        const preCtx = { ...ctx, inPre: true };
        // Пытаемся определить язык по классу <code class="language-python">
        let lang = '';
        const codeEl = node.querySelector('code');
        if (codeEl) {
          const cls = codeEl.className || '';
          const m = cls.match(/language-([a-z0-9+#-]+)/i);
          if (m) lang = m[1];
        }
        const code = (codeEl ? codeEl.textContent : node.textContent) || '';
        return '\n\n```' + lang + '\n' + code.replace(/\n+$/, '') + '\n```\n\n';
      }

      case 'a': {
        let href = node.getAttribute('href') || '';
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) href = absUrl(href);
        const text = childrenMd().trim();
        if (!href || href === text) return text;
        if (href.startsWith('javascript:') || href.startsWith('#')) return text;
        return text ? '[' + text + '](' + href + ')' : href;
      }

      case 'img': {
        const src = absUrl(node.getAttribute('src') || '');
        const alt = node.getAttribute('alt') || '';
        if (!src) return alt;
        return '![' + alt + '](' + src + ')';
      }

      case 'blockquote': {
        const inner = childrenMd().trim();
        return '\n\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      }

      case 'ul': case 'ol': {
        const items = Array.from(node.children).filter(c => c.tagName.toLowerCase() === 'li');
        const marker = i => tag === 'ol' ? (i + 1) + '. ' : '- ';
        const indent = '  '.repeat(ctx.listDepth);
        const nestedCtx = { ...ctx, listDepth: ctx.listDepth + 1 };
        const rendered = items.map((li, i) => {
          const liMd = Array.from(li.childNodes).map(c => nodeToMd(c, nestedCtx)).join('').trim();
          // Если пункт многострочный — сдвигаем продолжения
          const lines = liMd.split('\n');
          const head = lines[0];
          const tail = lines.slice(1).map(l => l ? indent + '  ' + l : l).join('\n');
          return indent + marker(i) + head + (tail ? '\n' + tail : '');
        });
        return '\n' + rendered.join('\n') + '\n';
      }
      case 'li': return childrenMd();  // обычно обрабатывается через ul/ol

      case 'table': {
        return '\n\n' + tableToMd(node) + '\n\n';
      }
      case 'thead': case 'tbody': case 'tfoot':
      case 'tr': case 'th': case 'td':
        return childrenMd();  // обрабатывается tableToMd

      case 'div': case 'span': case 'section': case 'article':
      case 'main': case 'header': case 'footer': case 'aside':
      case 'figure': case 'figcaption':
      default:
        return childrenMd();
    }
  }

  function tableToMd(table) {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = [];
      for (const cell of tr.querySelectorAll('th, td')) {
        // Схлопываем содержимое ячейки в одну строку (Markdown-таблицы однострочные)
        let txt = nodeToMd(cell, { listDepth: 0, inPre: false })
          .replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
        cells.push(txt);
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const cols = Math.max(...rows.map(r => r.length));
    // Выравниваем длину строк
    for (const r of rows) while (r.length < cols) r.push('');
    // Header — первая строка, отделитель — вторая
    const header = rows[0];
    const sep = new Array(cols).fill('---');
    const body = rows.slice(1);
    const line = r => '| ' + r.join(' | ') + ' |';
    return [line(header), line(sep), ...body.map(line)].join('\n');
  }

  // Собирает финальный Markdown-документ из захваченных HTML-сообщений
  function buildMarkdown() {
    if (_htmlMessages.length === 0) return '';

    // === ЕДИНАЯ ФИНАЛЬНАЯ ПОСТ-ОБРАБОТКА ===
    const coreOf = m => (m.core && m.core.length ? m.core : m.text);
    const keyOf = m => m.role + '|' + coreOf(m).slice(0, 100);

    // 1. Убираем огрызки-вложения (пустое ядро) при наличии полной версии.
    const fullAttachSigs = new Set();
    for (const m of _htmlMessages) if (m.attachSig && m.core) fullAttachSigs.add(m.attachSig);

    // 2. Глобальная дедупликация по ключу. Хвостовые сообщения (tail:true)
    //    добавляются в конец даже если ключ уже встречался (повторный показ),
    //    НО не дублируются между собой.
    const seen = new Set();
    const body = [];      // сообщения тела (не хвост)
    const tail = [];      // хвостовые (повторный показ у дна)
    const tailSeen = new Set();

    for (const m of _htmlMessages) {
      // огрызок?
      if (!m.core && m.attachSig && fullAttachSigs.has(m.attachSig)) continue;
      const k = keyOf(m);
      if (m.tail) {
        // Хвост: добавляем, если такого хвоста ещё не было
        if (!tailSeen.has(k)) { tailSeen.add(k); tail.push(m); }
      } else {
        if (!seen.has(k)) { seen.add(k); body.push(m); }
      }
    }

    // Хвост добавляем только если он НЕ дублирует последнее сообщение тела
    // (иначе повторный показ = то же, что уже в конце тела).
    const finalMsgs = body.slice();
    for (const m of tail) {
      const last = finalMsgs[finalMsgs.length - 1];
      if (last && keyOf(last) === keyOf(m)) continue;
      finalMsgs.push(m);
    }

    const out = [];
    const title = document.title || location.hostname;
    out.push('# ' + title + '\n');
    out.push('*' + location.href + '*\n');
    out.push('\n---\n');
    // Определяем платформу по хосту для правильной подписи ассистента
    const host = location.hostname || '';
    const assistantName = /gemini\.google\./i.test(host) ? '🤖 Gemini'
                        : /chatgpt\.com|openai\.com/i.test(host) ? '🤖 ChatGPT'
                        : '🤖 Claude';

    for (const msg of finalMsgs) {
      const marker = msg.role === 'user' ? '## 👤 You'
                   : msg.role === 'assistant' ? '## ' + assistantName
                   : '## 💬';
      const md = htmlToMarkdown(msg.html);
      out.push('\n' + marker + '\n\n' + md + '\n');
    }

    return out.join('\n')
      .split('\n').map(l => l.replace(/^\s+$/, '')).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n';
  }

  // ==================== АВТОПРОКРУТКА + OBSERVER ====================
  async function autoScroll(port, msg) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    _container = findScrollContainer();
    const c = _container;
    const useC = !!c;
    const src = c || document.body;

    // Параметры скорости из popup (дефолт: «Обычный»)
    const stepPct = msg && msg.stepPct ? msg.stepPct : 0.50;
    const pauseMs = msg && msg.pauseMs != null ? msg.pauseMs : 60;

    const sTop = () => useC ? c.scrollTop : window.scrollY;
    const sH   = () => useC ? c.scrollHeight : document.documentElement.scrollHeight;
    const vH   = () => useC ? c.clientHeight : window.innerHeight;
    const doS  = d => { if(useC) c.scrollBy(0,d); else window.scrollBy(0,d); };
    const goTop= () => { if(useC) c.scrollTop=0; else window.scrollTo(0,0); };

    // Observer: ловит и добавление элементов, и изменение текста в существующих
    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const t = (node.innerText || "").trim();
              if (t.length > 2) addLines(t);
            }
          }
        } else if (m.type === "characterData") {
          const t = (m.target.textContent || "").trim();
          if (t.length > 2) addLines(t);
        }
      }
    });
    observer.observe(src, { childList: true, subtree: true, characterData: true });

    // === ПЕРЕХОД НАВЕРХ ПЕРЕД ЗАХВАТОМ ===
    // Захват всегда должен идти СВЕРХУ ВНИЗ — так контент подгружается
    // естественно и быстро. Если пользователь нажал «Сохранить» находясь в
    // КОНЦЕ чата, без этого расширение застревает у дна: идти вниз некуда,
    // clickMore() начинает искать что кликать и может задеть вложение.
    // Поэтому сначала прокручиваем в самое начало.
    tell(port, "progress", "↑ Перехожу в начало чата…");
    goTop();
    await sleep(400);
    // На случай «Load earlier messages» вверху — дадим догрузиться и дойти
    // до истинного верха (несколько попыток).
    for (let t = 0; t < 5; t++) {
      const before = sTop();
      goTop();
      await sleep(300);
      if (sTop() <= 2 || sTop() === before) break;
    }
    goTop();
    await sleep(200);

    const step = Math.max(vH() * stepPct, 120);
    let stable=0, prevH=0, prevLines=0, clicks=0, empties=0;

    captureText();

    for (let i=0; i<10000; i++) {
      captureText();  // ДО скролла
      doS(step);
      await sleep(pauseMs);  // ждём отрисовку
      captureText();  // ПОСЛЕ скролла

      const h=sH(), y=sTop()+vH();
      if (i%15===0) {
        const pct=Math.min(99, Math.round(y/h*100));
        tell(port,"progress","Прокручиваю… "+pct+"% ("+_lines.length+" строк)");
      }

      if (y >= h-5) {
        captureText();
        if (clicks<30 && empties<5) {
          const before=_lines.length;
          const hBefore=sH();
          if (clickMore()) {
            clicks++;
            tell(port,"progress","⏳ Подгружаю… ("+_lines.length+" строк)");
            // Ждём дольше и скроллим вниз чтобы увидеть подгруженное
            await sleep(1500);
            if(useC) c.scrollTop = c.scrollHeight; else window.scrollTo(0, document.documentElement.scrollHeight);
            await sleep(500);
            captureText();
            // Считаем пустым только если НИ текст, НИ высота не изменились
            const grew = _lines.length > before+2 || sH() > hBefore+50;
            empties = grew ? 0 : empties+1;
            continue;
          }
        }
        await sleep(350);  // дать контенту дорендериться
        captureText();
        const h2=sH();
        const curLines=_lines.length;
        // Стабильно = и высота не меняется, И текст не растёт
        if(h2===h && h===prevH && curLines===prevLines){
          stable++;
          if(stable>=4) break;  // 4×350мс = 1.4с стабильности
        } else {
          stable=0;
        }
        prevH=h2;
        prevLines=curLines;
      }
    }

    // === ФИНАЛЬНАЯ ПРОВЕРКА: не обрезали ли конец? ===
    observer.disconnect();
    let linesBefore = _lines.length;
    tell(port, "progress", "🔍 Проверяю полноту… (" + _lines.length + " строк)");

    // Ждём дорендеринг и скроллим до дна (двойной проход с scroll-событием)
    await sleep(800);
    captureText();
    for (let attempt = 0; attempt < 2; attempt++) {
      if(useC) c.scrollTop = c.scrollHeight; else window.scrollTo(0, document.documentElement.scrollHeight);
      try {
        const target = useC ? c : window;
        target.dispatchEvent(new Event("scroll", {bubbles: true}));
      } catch(e){}
      await sleep(600);
      captureText();
    }

    // Подгрузка «Load more» — до 3 попыток, но паузы короче (2с вместо 4с).
    // Ждём только пока реально что-то грузится; если контент не растёт — выходим.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = _lines.length;
      if (clickMore()) {
        tell(port, "progress", "⏳ Подгружаю… (" + _lines.length + " строк)");
        await sleep(2000);
        if(useC) c.scrollTop = c.scrollHeight; else window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(400);
        captureText();
        if (_lines.length <= before + 2) break;  // ничего не подгрузилось — хватит
      } else {
        break;
      }
    }

    // Если появился новый контент — мини-проход дочитывания
    if (_lines.length > linesBefore + 2) {
      tell(port, "progress", "📥 Нашёлся доп. контент, дочитываю… (" + _lines.length + " строк)");
      const obs2 = new MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.type === "childList") {
            for (const node of m.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const t = (node.innerText || "").trim();
                if (t.length > 2) addLines(t);
              }
            }
          }
        }
      });
      obs2.observe(src, { childList: true, subtree: true });

      let st2=0, ph2=0;
      for (let j=0; j<2000; j++) {
        captureText();
        doS(step);
        await sleep(pauseMs);
        captureText();
        const h=sH(), y=sTop()+vH();
        if (y >= h-5) {
          await sleep(500);
          const h2=sH();
          if(h2===h && h===ph2){st2++;if(st2>=3)break;}
          else st2=0;
          ph2=h2;
        }
      }
      obs2.disconnect();
      captureText();
    }

    // Финальный захват с самого дна (после всех подгрузок)
    if(useC) c.scrollTop = c.scrollHeight; else window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(350);
    captureText();

    // === СЫРОЙ ПРОХОД ПО ХВОСТУ ===
    // Глобальная дедупликация выше могла выбросить ПОВТОРНЫЙ показ (Claude по
    // «покажи было и стало» заново вывел блок — это визуальный конец чата).
    // Поэтому отдельно собираем последнее сообщение СЫРЬЁМ (минуя _seen) и
    // дописываем в конец, чтобы файл заканчивался ровно там, где заканчивается чат.
    await appendRawTail(useC, c, src, vH, sH);

    // Восстанавливаем хвост и для .md-трека (последнее сообщение целиком)
    appendTailMessage(src);

    // Возврат наверх после сохранения (в начало чата) — по умолчанию включён,
    // так как захват теперь всегда идёт сверху вниз.
    if (!msg || msg.scrollBackTop !== false) {
      goTop();
      await sleep(200);
    }
  }

  // Собирает последний обмен (последний «You said:» + ответ Claude) сырьём,
  // проходя снизу вверх на несколько экранов, и дописывает в _lines.
  async function appendRawTail(useC, c, src, vH, sH) {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const setScroll = y => { if(useC) c.scrollTop=y; else window.scrollTo(0,y); };
    const isMarker = l => /^(👤\s*)?you said:/i.test(l) || /^(🤖\s*)?claude responded:/i.test(l) ||
                          /^(👤\s*)?ваш запрос/i.test(l) || /^(🤖\s*)?ответ gemini/i.test(l) ||
                          /^(👤\s*)?your query/i.test(l) || /^(🤖\s*)?gemini/i.test(l);

    try {
      const bottom = sH();
      const vh = vH();
      // Стартуем на ~4 экрана выше дна, идём вниз, собираем сырой текст
      let raw = [];
      let last = null;
      const startY = Math.max(0, bottom - vh * 4);
      for (let y = startY; y <= bottom + vh; y += Math.floor(vh * 0.6)) {
        setScroll(Math.min(y, bottom));
        await sleep(90);
        for (const r of (src.innerText || "").split("\n")) {
          const line = r.trim();
          if (!line || isUILine(line)) continue;
          if (line === last) continue;   // дедуп подряд идущих
          raw.push(line);
          last = line;
        }
      }
      // Схлопываем оставшиеся подряд-дубли
      const clean = [];
      for (const l of raw) if (clean[clean.length - 1] !== l) clean.push(l);

      // Находим ПОСЛЕДНИЙ «You said:» — начало финального обмена
      let mark = -1;
      for (let i = clean.length - 1; i >= 0; i--) {
        // Начало финального обмена = последний вопрос юзера (Claude «you said:»
        // или Gemini «ваш запрос»/«your query»)
        if (isMarker(clean[i]) && (/you said:/i.test(clean[i]) || /ваш запрос/i.test(clean[i]) || /your query/i.test(clean[i]))) { mark = i; break; }
      }
      if (mark < 0) return;  // не нашли — ничего не делаем

      const tail = clean.slice(mark);

      // Если этот обмен уже целиком в конце _lines — не дублируем.
      // Сравниваем без строк-маркеров ролей: в теле они остались только у
      // первого сообщения (глобальная дедупликация выбросила повторы), а в
      // сыром хвосте есть всегда, поэтому дословное сравнение расходилось
      // всегда и последний обмен уходил в файл дважды.
      const contentOf = arr => arr.filter(l => !isMarker(l));
      const tailContent = contentOf(tail);
      if (tailContent.length) {
        const bodyContent = contentOf(_lines);
        if (bodyContent.slice(-tailContent.length).join("\n") === tailContent.join("\n")) return;
      } else if (_lines.slice(-tail.length).join("\n") === tail.join("\n")) {
        return;
      }

      // Убираем из хвоста строки, которые прямо сейчас в самом конце _lines
      // (чтобы не было двойного шва), затем дописываем остальное сырьём.
      // Находим максимальное перекрытие суффикса _lines с префиксом tail.
      let overlap = 0;
      const maxO = Math.min(tail.length, _lines.length);
      for (let k = maxO; k > 0; k--) {
        if (_lines.slice(-k).join("\n") === tail.slice(0, k).join("\n")) { overlap = k; break; }
      }
      for (let i = overlap; i < tail.length; i++) _lines.push(tail[i]);
    } catch (e) {}
  }

  // ЗАЩИТА: селектор опасных для клика элементов (вложения/файлы/артефакты).
  const DANGER_SEL = [
    '[data-cds="MessageAttachments"]',
    '[data-cds="MessageAttachmentsFile"]',
    '[data-cds="Card"]',
    '[data-cds="CardLink"]',
    '[data-testid="file-thumbnail"]',
    '[data-testid*="attachment"]',
    '[data-testid*="artifact"]',
    '[class*="attachment"]',
    '[class*="artifact"]',
    'a[download]',
  ].join(',');

  // Никогда не кликаем вложения, кнопки скачивания, ссылки на файлы, артефакты —
  // иначе откроется превью файла и сохранение сломается.
  function isDangerous(el) {
    try {
      if (!el || !el.getAttribute) return false;
      // 1. Сам элемент или любой ПРЕДОК — опасный?
      if (el.closest && el.closest(DANGER_SEL)) return true;
      // 2. Элемент СОДЕРЖИТ вложение/карточку внутри (клик по обёртке)?
      if (el.querySelector && el.querySelector(DANGER_SEL)) return true;
      // 3. Атрибуты: download / ссылка на файл / имя файла
      const dl = el.getAttribute('download');
      if (dl !== null && dl !== undefined) return true;
      const href = el.getAttribute('href') || '';
      if (href && /\.(zip|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|png|jpe?g|gif|svg|exe|dll|bin)(\?|$)/i.test(href)) return true;
      const title = el.getAttribute('title') || '';
      if (title && /\.(zip|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|png|jpe?g|svg)$/i.test(title)) return true;
      // 4. Текст выглядит как имя файла или бейдж-тип (ZIP, PDF…)
      const txt = (el.textContent || '').trim();
      if (txt.length < 90 && /\.(zip|pdf|docx?|xlsx?|pptx?|csv|json|png|jpe?g|svg|exe)\b/i.test(txt)) return true;
      if (/^(zip|pdf|docx?|xlsx?|pptx?|csv|json|jsonl|png|jpe?g|svg|txt|md|exe|dll|bin)$/i.test(txt)) return true;
    } catch(e){}
    return false;
  }

  function clickMore() {
    const host = location.hostname || '';
    const isChatSite = /claude\.ai|gemini\.google\.|chatgpt\.com|openai\.com/i.test(host);
    const isGemini = /gemini\.google\./i.test(host);

    // Gemini: разворачиваем свёрнутые запросы (иначе текст обрезается), но
    // строго проверяя, что это НЕ вложение/файл.
    if (isGemini) {
      try {
        for (const el of document.querySelectorAll('.luminous-collapsed, button[aria-label*="Развернуть"], button[aria-label*="Expand"]')) {
          if (isDangerous(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
      } catch(e){}
    }

    // На claude.ai/Gemini/ChatGPT НЕТ пагинации «Load more» — весь чат в одном
    // скролле. Любой клик по кнопкам рискует активировать вложение/артефакт.
    // Поэтому пагинация здесь ПОЛНОСТЬЮ отключена — прокрутки достаточно.
    if (isChatSite) return false;

    // ВАЖНО: кликаем ТОЛЬКО кнопки, загружающие контент ВПЕРЁД (вниз/новее).
    // «Load earlier / older / previous» ЗАПРЕЩЕНЫ — они подгружают старые
    // сообщения, которые добавляются в конец массива и ЛОМАЮТ порядок,
    // погребая хвост. Именно это скремблировало вывод в старых версиях.

    // Разрешённые фразы (загрузка вперёд / раскрытие)
    const kwAllow = [
      "load later messages", "load newer messages", "load next messages",
      "load more", "show more", "see more", "view more",
      "показать ещё", "показать еще", "загрузить ещё", "загрузить еще",
      "загрузить позже", "показать позже",
    ];
    // Запрещённые подстроки — если есть, НЕ кликаем ни при каких условиях
    const kwForbid = [
      "earlier", "older", "previous", "back",
      "ранее", "раньше", "предыдущ", "назад", "старее", "старые",
    ];

    function isSafeMatch(text) {
      const t = text.trim().toLowerCase();
      if (!t || t.length > 80 || t.length < 3) return false;
      // Сначала проверяем запреты
      for (const f of kwForbid) {
        if (t.includes(f)) return false;
      }
      // Потом разрешённые
      for (const k of kwAllow) {
        if (t === k || t.includes(k)) return true;
      }
      return false;
    }

    try {
      // Кликабельные элементы — но БЕЗ широкого div[class*='message']
      // (он мог кликать сами сообщения). Только явные кнопки/ссылки.
      const sel = "button, a, [role='button'], [role='link'], div[class*='load-more'], span[class*='load-more']";
      for (const el of document.querySelectorAll(sel)) {
        if (isDangerous(el)) continue;  // не трогаем вложения/файлы/артефакты
        if (isSafeMatch(el.textContent || "")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            el.click();
            return true;
          }
        }
      }
      // aria-label
      for (const el of document.querySelectorAll("[aria-label]")) {
        if (isDangerous(el)) continue;
        if (isSafeMatch(el.getAttribute("aria-label") || "")) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
      }
    } catch(e){}
    return false;
  }

  // ==================== РЕЗУЛЬТАТ ====================
  function cleanupLines(lines) {
    // 1. Убираем строки-дубли соседей (UI-фрагменты, попавшие дважды подряд)
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Пропускаем, если эта короткая строка идентична предыдущей или через одну
      if (line.length < 40) {
        if (i > 0 && lines[i - 1] === line) continue;
        if (i > 1 && lines[i - 2] === line) continue;
      }
      out.push(line);
    }
    return out;
  }

  function buildResult() {
    const clean = cleanupLines(_lines);
    const text = clean.join("\n");
    const html = textToHtml(withImages(clean));
    const markdown = buildMarkdown();  // v7.4: Markdown с форматированием
    return {
      title: document.title || location.hostname,
      url: location.href,
      text, html, markdown,
      htmlMsgCount: _htmlMessages.length
    };
  }

  // ==================== ТЕКСТ → СТРУКТУРИРОВАННЫЙ HTML ====================
  function textToHtml(lines) {
    const out = [];
    let inCode = false;
    let inList = "";   // "" | "ul" | "ol" — тип открытого списка
    let codeBuf = [];

    function closeList() {
      if (inList) { out.push("</" + inList + ">"); inList = ""; }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Картинка (вставлена withImages после строки-якоря)
      if (typeof line !== "string") {
        if (!inCode) {
          closeList();
          out.push('<p><img src="' + escAttr(line.img) + '" alt="' + escAttr(line.alt) + '"></p>');
        }
        continue;
      }

      // Блок кода (``` ... ```)
      if (line.startsWith("```")) {
        if (inCode) {
          out.push('<pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere"><code>'
            + esc(codeBuf.join("\n")) + "</code></pre>");
          codeBuf = [];
          inCode = false;
        } else {
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      // Заголовки
      const hMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (hMatch) {
        closeList();
        const level = Math.min(hMatch[1].length, 4);
        out.push("<h" + level + ">" + esc(hMatch[2]) + "</h" + level + ">");
        continue;
      }

      // «You said:» / «Claude responded:» — маркеры сообщений
      if (/^you said:/i.test(line)) {
        closeList();
        out.push('<h3 style="color:#1a7f37;border-top:2px solid #e0e0e0;padding-top:12px;margin-top:20px">👤 '
          + esc(line) + "</h3>");
        continue;
      }
      if (/^claude responded:/i.test(line)) {
        closeList();
        out.push('<h3 style="color:#6f42c1;border-top:2px solid #e0e0e0;padding-top:12px;margin-top:20px">🤖 '
          + esc(line) + "</h3>");
        continue;
      }

      // Маркированный список
      if (/^[-•*]\s/.test(line)) {
        if (inList !== "ul") { closeList(); out.push("<ul>"); inList = "ul"; }
        out.push("<li>" + formatInline(line.replace(/^[-•*]\s+/, "")) + "</li>");
        continue;
      }
      // Нумерованный список
      if (/^\d+[.)]\s/.test(line)) {
        if (inList !== "ol") { closeList(); out.push("<ol>"); inList = "ol"; }
        out.push("<li>" + formatInline(line.replace(/^\d+[.)]\s+/, "")) + "</li>");
        continue;
      }
      closeList();

      // Обычный абзац
      out.push("<p>" + formatInline(line) + "</p>");
    }

    if (inCode && codeBuf.length) {
      out.push('<pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere"><code>'
        + esc(codeBuf.join("\n")) + "</code></pre>");
    }
    closeList();

    return out.join("\n");
  }

  function formatInline(s) {
    // **bold** → <strong>
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // `code` → <code>
    s = s.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px">$1</code>');
    return s;
  }

  // ==================== УТИЛИТЫ ====================
  function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function escAttr(s){return esc(s).replace(/"/g,"&quot;");}
  function absUrl(u){try{return new URL(u,location.href).href;}catch(e){return u;}}
  function safeName(t){return(t||"page").replace(/[\\/:*?"<>|\n\r\t]+/g," ").replace(/\s+/g," ").trim().slice(0,80)||"page";}

  function wrap(d, body, mode) {
    const t = esc(d.title), u = esc(d.url);
    const css = 'body{max-width:860px;margin:24px auto;padding:0 16px;font:15px/1.6 sans-serif;color:#222;}'
      +'img{max-width:100%;height:auto;}a{color:#1a4fa0;word-break:break-word;}'
      +'p{margin:0.5em 0;}pre{background:#f4f4f4;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;}'
      +'code{font-family:Consolas,Monaco,monospace;}h1,h2,h3,h4{margin:1em 0 0.4em;}'
      +'blockquote{border-left:3px solid #ccc;padding-left:12px;color:#555;margin:0.5em 0;}'
      +'ul,ol{margin:0.5em 0;}li{margin:0.2em 0;}'
      +'table{border-collapse:collapse;width:100%;margin:0.6em 0;font-size:14px;}'
      +'th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;word-break:break-word;}'
      +'th{background:#f4f4f4;}';

    if (mode === "word") {
      return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"'
        +' xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>'+t+'</title>'
        +'<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->'
        +'<style>'+css+'</style></head><body><h1>'+t+'</h1><p>Источник: <a href="'+u+'">'+u+'</a></p>'+body+'</body></html>';
    }
    if (mode === "print") {
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+t+'</title><style>'
        +css.replace(/font:15px/,'font:14px')
        +'@media print{a{color:#111;text-decoration:none;}}</style></head><body>'
        +'<h1 style="font-size:20px">'+t+'</h1><div style="font-size:11px;color:#999;margin:0 0 18px">'+u+'</div>'
        +body+'</body></html>';
    }
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+t+'</title><style>'+css+'</style></head><body>'
      +'<h1>'+t+'</h1><p style="color:#888;font-size:13px;">Источник: <a href="'+u+'">'+u+'</a></p><hr>'+body+'</body></html>';
  }

  // ==================== ВСТРАИВАНИЕ КАРТИНОК ====================
  // Сначала качаем отсюда (работают куки страницы и blob:-адреса), а если
  // мешает CORS чужого домена — просим popup: у страниц расширения с
  // host_permissions этого ограничения нет.
  async function embedImages(html, port, onProgress) {
    const doc=new DOMParser().parseFromString("<body>"+html+"</body>","text/html");
    const imgs=[...doc.querySelectorAll("img[src]")].filter(i=>/^(https?:|blob:)/i.test(i.getAttribute("src")||""));
    if(!imgs.length)return html;
    let done=0;
    for(let i=0;i<imgs.length;i+=4){
      await Promise.all(imgs.slice(i,i+4).map(async img=>{
        const src=img.getAttribute("src");
        let uri=await fetchAsDataUrl(src);
        if(!uri&&/^https?:/i.test(src))uri=await fetchViaPopup(port,src);
        if(uri)img.setAttribute("src",uri);
        done++;if(onProgress)onProgress(done,imgs.length);
      }));
    }
    return doc.body.innerHTML;
  }

  async function fetchAsDataUrl(url) {
    try{
      const ac=new AbortController();const tm=setTimeout(()=>ac.abort(),10000);
      const resp=await fetch(url,{signal:ac.signal});clearTimeout(tm);
      if(!resp.ok)return null;
      const blob=await resp.blob();
      if(blob.size>5e6||!/^image\//i.test(blob.type))return null;
      return await new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=bad;r.readAsDataURL(blob);});
    }catch(e){return null;}
  }

  function fetchViaPopup(port, url) {
    return new Promise(resolve=>{
      const id=++_imgReqId;
      const tm=setTimeout(()=>{_imgPending.delete(id);resolve(null);},15000);
      _imgPending.set(id,data=>{clearTimeout(tm);resolve(data);});
      try{port.postMessage({type:"fetchImage",id,url});}
      catch(e){clearTimeout(tm);_imgPending.delete(id);resolve(null);}  // popup закрыт
    });
  }
})();
