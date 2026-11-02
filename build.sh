#!/usr/bin/env bash
# Собирает готовые пакеты для Firefox и Chromium в папку dist/.
#
#   ./build.sh
#
# На выходе:
#   dist/page-saver-firefox-<версия>.zip  — загружать на addons.mozilla.org
#   dist/page-saver-chrome-<версия>.zip   — загружать в Chrome Web Store
#
# Различия сборок:
#   Firefox  — есть background.js и кнопка «PDF сразу в файл» (tabs.saveAsPDF).
#   Chromium — фонового скрипта нет, PDF сохраняется через диалог печати.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')
COMMON=(popup.html popup.js content.js print.js icon-16.png icon-32.png icon-48.png icon-96.png icon-128.png icon.svg LICENSE README.md)

rm -rf dist && mkdir -p dist/firefox dist/chrome

cp "${COMMON[@]}" dist/firefox/
cp background.js   dist/firefox/
cp manifest.json   dist/firefox/manifest.json

cp "${COMMON[@]}" dist/chrome/
cp manifest-chrome.json dist/chrome/manifest.json

(cd dist/firefox && zip -qr "../page-saver-firefox-$VERSION.zip" .)
(cd dist/chrome  && zip -qr "../page-saver-chrome-$VERSION.zip"  .)

rm -rf dist/firefox dist/chrome
echo "Готово:"
ls -1 dist/
