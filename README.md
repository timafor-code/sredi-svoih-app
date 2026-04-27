# Среди Своих

iOS-приложение для русскоязычной еврейской общины.

## Цель

Создать полноценное Expo React Native приложение по HTML/JavaScript-прототипу.

## Главные исходные файлы

- `docs/prototype/sredi-svoih.html` — главный HTML/React-прототип интерфейса.
- `docs/prototype/ios-frame.jsx` — дополнительный визуальный reference по iOS/Liquid Glass-элементам.
- `docs/product/app-description.txt` — продуктово-техническое описание проекта.
- `assets/logo.svg` — векторный логотип из прототипа.

## Важное правило

HTML-прототип используется только как визуальная и продуктовая спецификация.

Запрещено:
- использовать WebView;
- переносить HTML как HTML;
- использовать DOM;
- рисовать fake iPhone shell;
- рисовать fake Dynamic Island;
- рисовать fake status bar.

Нужно:
- создать нативное Expo React Native приложение;
- использовать TypeScript;
- использовать expo-router;
- использовать Zustand;
- подготовить Supabase/PostgreSQL;
- подготовить Hebcal;
- подготовить iOS Contacts;
- подготовить Notifications.

## Планируемый стек

- Expo
- React Native
- TypeScript
- expo-router
- Zustand
- @hebcal/core
- Supabase / PostgreSQL
- expo-contacts
- expo-notifications
- expo-location
- expo-secure-store
- expo-blur
- expo-linear-gradient

## Приоритет источников для Codex

1. UI, экраны, навигация и визуальная композиция — `docs/prototype/sredi-svoih.html`.
2. iOS/Liquid Glass reference — `docs/prototype/ios-frame.jsx`.
3. Архитектура, стек, Hebcal, Supabase/PostgreSQL, контакты и уведомления — `docs/product/app-description.txt`.

Если описание экранов в `docs/product/app-description.txt` расходится с HTML-прототипом, приоритет у HTML-прототипа.

## Запуск после генерации проекта

```bash
npm install
npx expo start
