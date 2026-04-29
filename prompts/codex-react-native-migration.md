Ты senior React Native / Expo developer, iOS UI engineer и backend architect.

Репозиторий:
https://github.com/timafor-code/sredi-svoih-app

Задача:
Создать полноценное Expo React Native приложение «Среди Своих» по приложенному HTML/JavaScript-прототипу.

ВАЖНО:
- Репозиторий может быть пустым. Если он пустой — создай Expo-проект прямо в корне репозитория.
- Не используй WebView.
- Не переноси HTML/CSS 1-в-1.
- Не используй DOM, div, span, document, window.
- Не рисуй fake iPhone frame, Dynamic Island и fake status bar.
- HTML/JS-прототип используй как главный источник правды по экранам, структуре, визуальной композиции и пользовательским сценариям.
- Файл `Описание-приложения.txt` используй как источник по стеку, архитектуре, Hebcal, Supabase/PostgreSQL, iOS, уведомлениям, контактам и ограничениям, но экраны и текущую структуру интерфейса бери из HTML-прототипа, потому что описание местами устарело.
- Интерфейс должен быть нативным React Native/Expo, а не веб-имитацией.
- Дизайн: тёмный iOS-style, glass / liquid-glass inspired, с blur, мягкими borders, правильными Safe Areas, аккуратными списками и нативной навигацией.
- Язык интерфейса: русский.
- Сначала можно использовать mock data, но архитектура должна быть готова к реальной синхронизации с Supabase/PostgreSQL и расчётам через Hebcal.

Цель первого большого PR:
1. Создать рабочее Expo React Native приложение.
2. Перенести все основные экраны из HTML-прототипа.
3. Настроить навигацию через expo-router.
4. Сделать дизайн-систему.
5. Заложить слой данных для Supabase/PostgreSQL.
6. Заложить слой Hebcal для еврейского календаря, зманим, праздников и еврейских дат рождения.
7. Подготовить синхронизацию контактов iPhone, но без автоматической отправки всех контактов на сервер.
8. Проект должен запускаться через `npx expo start`.

Технологический стек:
- Expo managed workflow
- TypeScript
- expo-router
- Zustand
- react-native-safe-area-context
- react-native-screens
- expo-blur
- expo-linear-gradient
- react-native-svg
- @expo/vector-icons
- @hebcal/core
- @supabase/supabase-js
- i18next + react-i18next
- expo-location
- expo-contacts
- expo-notifications
- expo-secure-store

Команды, если проект ещё не создан:
- npx create-expo-app . -t expo-template-blank-typescript
- npx expo install expo-router react-native-safe-area-context react-native-screens
- npx expo install expo-blur expo-linear-gradient react-native-svg
- npx expo install expo-location expo-contacts expo-notifications expo-secure-store
- npm install zustand @hebcal/core @supabase/supabase-js i18next react-i18next

Структура проекта:

app/
  _layout.tsx

  (tabs)/
    _layout.tsx
    index.tsx
    prayers.tsx
    events.tsx
    contacts.tsx
    profile.tsx

  profile/
    edit.tsx
    prayers-settings.tsx
    my-events.tsx
    contacts-settings.tsx
    notifications.tsx
    siddur.tsx
    support.tsx
    about.tsx

  contacts/
    [id].tsx

  modals/
    omer.tsx
    city-picker.tsx
    event-registration.tsx

src/
  components/
    glass/
      GlassCard.tsx
      GlassTabBarBackground.tsx
      GlassHeaderButton.tsx
      GlassBottomSheet.tsx

    ui/
      Screen.tsx
      PrimaryButton.tsx
      SecondaryButton.tsx
      SegmentControl.tsx
      ListRow.tsx
      SectionTitle.tsx
      Avatar.tsx
      ProgressBar.tsx
      Pill.tsx
      IconButton.tsx
      EmptyState.tsx
      FormField.tsx
      IOSGroup.tsx
      ToggleRow.tsx

    home/
      HomeHeader.tsx
      OmerPill.tsx
      ShmaDeadlineCard.tsx
      FeaturedEventCard.tsx
      PrayerNowCard.tsx
      DayTimelineCard.tsx
      WeeklyParshaCard.tsx
      CandleLightingCard.tsx
      HolidayCard.tsx
      BirthdayPreviewList.tsx

    prayers/
      PrayerCard.tsx
      ZmanimTimeline.tsx
      ZmanimList.tsx
      CitySourcePill.tsx

    events/
      EventCard.tsx
      EventFilter.tsx
      EventRegistrationSheet.tsx

    contacts/
      ContactRow.tsx
      ContactDetailHero.tsx
      BirthdayList.tsx
      ContactSearch.tsx
      ContactsSyncBanner.tsx

    profile/
      ProfileHero.tsx
      ProfileMenuGroup.tsx
      ProfileBookingCard.tsx

  theme/
    colors.ts
    spacing.ts
    radius.ts
    typography.ts
    shadows.ts

  store/
    useAppStore.ts
    useSettingsStore.ts
    useAuthStore.ts
    useContactsStore.ts
    useEventsStore.ts

  data/
    events fixture file
    mockContacts.ts
    mockZmanim.ts
    mockOmer.ts
    mockUser.ts

  lib/
    supabase.ts
    hebcal.ts
    zmanim.ts
    contacts.ts
    notifications.ts
    location.ts
    dates.ts

  services/
    profileService.ts
    eventsService.ts
    contactsService.ts
    calendarService.ts
    syncService.ts

  types/
    user.ts
    event.ts
    contact.ts
    prayer.ts
    calendar.ts
    database.ts

supabase/
  migrations/
    0001_init.sql
  seed.sql
  README.md

docs/
  README.md
  product-notes.md
  database-schema.md
  privacy-notes.md
  hebcal-notes.md

Исходный UI из HTML-прототипа:
Перенеси в React Native следующие экраны и сценарии:

1. Главная
- Header с логотипом / названием «Среди Своих»
- OmerPill
- еврейская дата
- гражданская дата
- город / источник зманим
- карточка дедлайна утреннего Шма
- большая карточка ближайшего события
- карточка текущей/следующей молитвы
- шкала дня
- недельная глава
- зажигание свечей
- ближайший праздник
- ближайшие дни рождения

2. Молитвы
- заголовок «Молитвы и зманим»
- выбранный город
- indication: «по выбранному городу, не по GPS»
- шкала дня
- карточки Шахарит / Минха / Маарив
- активная молитва с progress bar
- таблица зманим

3. События
- заголовок «События»
- подзаголовок «Афиша мероприятий общины»
- поиск
- SegmentControl: Все / Курсы / Праздники
- список событий
- большая карточка первого события
- кнопки «Хочу пойти»

4. Контакты
- SegmentControl: Община / Мои контакты
- поиск
- блок ближайших дней рождения
- блок синхронизации iPhone
- список контактов общины
- список личных контактов
- переход в карточку контакта

5. Карточка контакта
- avatar
- имя
- еврейское имя
- роль
- город
- кнопки «Написать» / «Позвонить»
- личные данные
- гражданская и еврейская дата рождения
- происхождение: Коэн / Леви / Исраэль
- семейное положение
- телефон/email
- деятельность в общине
- следующий еврейский день рождения

6. Профиль
- ProfileHero
- имя, еврейское имя, город, статус участника
- кнопка «Редактировать профиль»
- карточка ближайшей записи
- меню:
  - Настройки молитв и календаря
  - Мои записи на мероприятия
  - Контакты и дни рождения
  - Уведомления
  - Сидур
  - Поддержать общину
  - О приложении
- кнопка выхода

7. Вложенные экраны профиля
- Редактировать профиль
- Настройки молитв и календаря
- Мои записи
- Контакты и дни рождения
- Уведомления
- Сидур
- Поддержать общину
- О приложении

8. Omer modal / bottom sheet
- открывается по нажатию на OmerPill
- показывает:
  - номер дня Омера
  - сфиру дня
  - сфиру недели
  - название на русском
  - название на иврите
  - смысл дня
  - описание
  - кавану
  - рекомендации
  - текст счёта на иврите
  - русский перевод

Навигация:
- Использовать expo-router.
- Нижние табы:
  - Главная
  - Молитвы
  - События
  - Контакты
  - Профиль
- Вложенные экраны профиля должны быть отдельными routes, а не локальным state-переключением как в HTML-прототипе.
- Карточка контакта должна быть route `/contacts/[id]`.
- Omer можно сделать modal route `/modals/omer` или нативным bottom sheet-компонентом.

App config:
- name: Среди Своих
- slug: sredi-svoih-app
- scheme: sredisvoih
- orientation: portrait
- userInterfaceStyle: dark
- iOS bundleIdentifier placeholder: com.sredisvoih.app
- Android package placeholder: com.sredisvoih.app
- icons/splash можно сделать временно, если нет финальных assets

Дизайн-токены:
colors:
- bg: #0D0D1A
- surface.base: #16162A
- surface.raised: #1E1E35
- surface.elevated: #252540
- brand.red: #E52C36
- brand.gold: #F6A400
- brand.orange: #F07A2A
- brand.orangeDark: #E05A10
- brand.blue: #6B7FD4
- text.primary: #FFFFFF
- text.secondary: rgba(255,255,255,0.62)
- text.tertiary: rgba(255,255,255,0.38)
- text.muted: rgba(255,255,255,0.25)
- glass.tint: rgba(255,255,255,0.07)
- glass.tintStrong: rgba(255,255,255,0.12)
- glass.border: rgba(255,255,255,0.10)
- glass.separator: rgba(255,255,255,0.08)
- success: #4CAF50
- danger: #FF5555

Radius:
- xs: 8
- sm: 12
- md: 16
- lg: 20
- xl: 26
- pill: 999

Spacing:
- 4, 8, 12, 16, 20, 28, 32

Typography:
- Использовать системный iOS font.
- Не хардкодить Roboto как основной шрифт.
- Для иврита предусмотреть отдельные стили:
  - writingDirection: 'rtl'
  - увеличенная lineHeight
  - fontSize чуть больше русского текста
- Все стили — через StyleSheet/theme, не через огромные inline styles.

Glass / Apple-style UI:
- Использовать expo-blur.
- Glass применять дозированно:
  - tab bar background
  - floating header controls
  - важные карточки на главной
  - Omer bottom sheet
  - CTA-блоки
- Не делать весь интерфейс прозрачным.
- Длинные списки настроек и контактов делать как grouped iOS lists.
- Touch target минимум 44 px.
- Tab bar не должен перекрывать контент.
- Все экраны должны учитывать Safe Area.
- На Android сделать fallback без настоящего blur.

Компоненты:
Создай переиспользуемые компоненты:
- Screen
- GlassCard
- IOSGroup
- ListRow
- PrimaryButton
- SegmentControl
- Avatar
- ProgressBar
- Pill
- FormField
- ToggleRow
- GlassBottomSheet

Состояние:
Использовать Zustand.

useSettingsStore:
- selectedCity
- selectedTimezone
- useGpsForZmanim
- nusach
- siddurLanguage
- notification settings
- contactsSyncEnabled
- birthdayReminderSettings

useAuthStore:
- currentUser
- isAuthenticated
- auth placeholder methods

useEventsStore:
- events
- registrations
- registerForEvent
- cancelRegistration

useContactsStore:
- communityContacts
- localContacts
- search
- syncStatus
- birthdayList

useAppStore:
- app boot state
- active community
- current date cache

Hebcal / calendar layer:
Создай `src/lib/hebcal.ts` и `src/lib/zmanim.ts`.

Требования:
- Использовать @hebcal/core.
- Подготовить функции:
  - getHebrewDate(date, locale)
  - getParsha(date, location)
  - getHolidays(dateRange, location)
  - getOmerDay(date)
  - getOmerInfo(date)
  - getZmanim(date, location)
  - getCandleLighting(date, location)
  - getHavdalah(date, location)
  - convertGregorianBirthdayToHebrewDate(date, afterSunset?)
  - getNextHebrewBirthday(gregorianDate, afterSunset?)
- На первом этапе можно вернуть mock или частично реальные расчёты, но структура функций должна быть production-oriented.
- Город должен хранить координаты, timezone и название.
- Важно: зманим считаются по выбранному городу, а не автоматически по GPS, если пользователь явно выбрал город.
- GPS нужен только как опциональный источник предложения города.

Контакты iPhone:
Создай `src/lib/contacts.ts`.

Требования:
- Использовать expo-contacts.
- Запрашивать permission явно.
- Не отправлять все контакты на сервер автоматически.
- Локальные контакты iPhone использовать для:
  - отображения имени
  - гражданской даты рождения
  - расчёта еврейской даты рождения локально через Hebcal
  - локальных напоминаний
- Синхронизация с сервером должна быть opt-in.
- Для серверной синхронизации отправлять только те данные, на которые пользователь явно согласился.
- Подготовить тип LocalContactWithHebrewBirthday.

Уведомления:
Создай `src/lib/notifications.ts`.

Требования:
- Использовать expo-notifications.
- Подготовить функции:
  - requestNotificationPermissions()
  - schedulePrayerReminder()
  - scheduleCandleLightingReminder()
  - scheduleHolidayReminder()
  - scheduleBirthdayReminder()
  - cancelReminder()
- На первом этапе реальные уведомления можно не включать в UI автоматически, но функции должны быть подготовлены.

Supabase / PostgreSQL:
Создай `src/lib/supabase.ts`.

Требования:
- Использовать @supabase/supabase-js.
- Не хардкодить реальные ключи.
- Использовать env:
  - EXPO_PUBLIC_SUPABASE_URL
  - EXPO_PUBLIC_SUPABASE_ANON_KEY
- Если env нет, приложение не должно падать. Должен быть безопасный fallback и предупреждение в dev mode.
- Подготовить сервисы:
  - profileService
  - eventsService
  - contactsService
  - calendarService
  - syncService

Создай миграцию `supabase/migrations/0001_init.sql`.

Минимальная схема PostgreSQL:

1. communities
- id uuid primary key
- name text not null
- city text
- timezone text
- latitude numeric
- longitude numeric
- created_at timestamptz default now()

2. profiles
- id uuid primary key references auth.users(id) on delete cascade
- community_id uuid references communities(id)
- first_name text
- last_name text
- hebrew_name text
- phone text
- email text
- city text
- tribe text check in ('kohen', 'levi', 'israel')
- marital_status text
- bio text
- birth_date date
- birth_after_sunset boolean default false
- hebrew_birth_date text
- avatar_url text
- visibility text default 'community'
- created_at timestamptz default now()
- updated_at timestamptz default now()

3. community_contacts
- id uuid primary key default gen_random_uuid()
- community_id uuid references communities(id)
- profile_id uuid references profiles(id)
- display_name text not null
- hebrew_name text
- role text
- role_color text
- phone text
- email text
- city text
- tribe text
- marital_status text
- birth_date date
- birth_after_sunset boolean default false
- hebrew_birth_date text
- bio text
- avatar_url text
- is_public boolean default false
- created_at timestamptz default now()
- updated_at timestamptz default now()

4. events
- id uuid primary key default gen_random_uuid()
- community_id uuid references communities(id)
- title text not null
- subtitle text
- description text
- category text
- starts_at timestamptz
- ends_at timestamptz
- location text
- capacity int
- image_url text
- registration_enabled boolean default true
- price_amount numeric
- currency text
- created_at timestamptz default now()
- updated_at timestamptz default now()

5. event_registrations
- id uuid primary key default gen_random_uuid()
- event_id uuid references events(id) on delete cascade
- profile_id uuid references profiles(id) on delete cascade
- status text default 'registered'
- guests_count int default 0
- created_at timestamptz default now()
- unique(event_id, profile_id)

6. user_settings
- profile_id uuid primary key references profiles(id) on delete cascade
- selected_city text
- timezone text
- latitude numeric
- longitude numeric
- use_gps_for_zmanim boolean default false
- nusach text default 'ashkenaz'
- siddur_language text default 'hebrew_ru'
- notifications jsonb default '{}'
- contacts_sync_enabled boolean default false
- created_at timestamptz default now()
- updated_at timestamptz default now()

7. synced_contacts
- id uuid primary key default gen_random_uuid()
- profile_id uuid references profiles(id) on delete cascade
- display_name text not null
- phone_hash text
- email_hash text
- birth_date date
- birth_after_sunset boolean default false
- hebrew_birth_date text
- reminder_enabled boolean default true
- created_at timestamptz default now()
- updated_at timestamptz default now()

8. calendar_cache
- id uuid primary key default gen_random_uuid()
- city text not null
- timezone text not null
- date date not null
- payload jsonb not null
- created_at timestamptz default now()
- unique(city, timezone, date)

RLS:
- Включить RLS для всех пользовательских таблиц.
- profiles: пользователь видит и редактирует только свой профиль; публичные поля можно читать участникам общины.
- events: можно читать всем участникам общины.
- event_registrations: пользователь видит и редактирует свои записи.
- user_settings: только владелец.
- synced_contacts: только владелец.
- community_contacts: читать можно согласно is_public/community visibility, редактировать только админам в будущем.
- Если admin roles ещё не реализованы, оставить безопасные placeholder policies и комментарии.

Создай `supabase/seed.sql`:
- одна community «Среди Своих»
- несколько mock events
- несколько community_contacts
- demo profile можно оставить комментарием, так как auth.users нельзя просто сидить без Auth.

Важно по приватности:
- Личные iPhone contacts не должны автоматически попадать в Postgres.
- Сначала расчёт еврейских дней рождения делается локально.
- Серверная синхронизация только после явного consent.
- Для телефона/email в synced_contacts желательно хранить hash, а не исходное значение.
- В UI добавь понятное объяснение: «Контакты используются локально для расчёта еврейских дат и напоминаний. Синхронизация с сервером включается отдельно».

Mock data:
До реального backend использовать mock-файлы:
- events fixture file
- mockContacts.ts
- mockZmanim.ts
- mockOmer.ts
- mockUser.ts

Но services должны иметь одинаковый интерфейс:
- сначала читают mock
- позже можно переключить на Supabase

Не делай сейчас:
- реальную оплату
- реальный Apple Sign-In
- реальную публикацию в App Store
- реальные push-уведомления без действия пользователя
- автоматическую серверную отправку контактов
- WebView

Сделай сейчас:
- UI полностью рабочий
- navigation полностью рабочая
- mock data вынесены
- Supabase/Postgres schema подготовлена
- Hebcal слой подготовлен
- Contacts/Notifications слой подготовлен
- README с инструкцией запуска
- .env.example
- supabase README

Файлы документации:
Создай:

README.md:
- что это за приложение
- стек
- как запустить
- как добавить env
- как запустить Expo
- что сейчас mock
- что готово для Supabase/Postgres
- что готово для Hebcal
- что осталось сделать

docs/database-schema.md:
- описание таблиц
- зачем каждая таблица
- privacy notes

docs/hebcal-notes.md:
- какие расчёты через @hebcal/core
- что зависит от города
- что зависит от рождения после заката

docs/privacy-notes.md:
- контакты iPhone локально
- sync only with consent
- phone/email hash
- RLS в Supabase

Качество:
- TypeScript без грубых any.
- Компоненты типизированы.
- Не создавать один гигантский файл.
- Не оставлять мёртвый код.
- Не оставлять незавершённые TODO без объяснения.
- Все экраны должны скроллиться.
- Tab bar не перекрывает контент.
- Нативные Pressable states.
- Списки используют FlatList/ScrollView разумно.
- Для больших списков контактов использовать FlatList.
- Всё должно запускаться через `npx expo start`.

Acceptance criteria:
1. Проект запускается через:
   - npm install
   - npx expo start
2. Есть 5 табов:
   - Главная
   - Молитвы
   - События
   - Контакты
   - Профиль
3. Работают переходы:
   - Профиль → Редактировать профиль
   - Профиль → Настройки молитв
   - Профиль → Мои записи
   - Профиль → Контакты и дни рождения
   - Профиль → Уведомления
   - Профиль → Сидур
   - Профиль → Поддержать общину
   - Профиль → О приложении
   - Контакты → Карточка контакта
   - OmerPill → Omer modal/bottom sheet
4. Работает поиск контактов.
5. Работает SegmentControl на событиях.
6. Работает SegmentControl на контактах.
7. Работают toggles/switches в настройках.
8. Есть дизайн-система.
9. Есть mock data.
10. Есть Supabase/PostgreSQL migration.
11. Есть Hebcal abstraction layer.
12. Есть contacts abstraction layer.
13. Есть notifications abstraction layer.
14. Нет HTML/WebView/DOM.
15. Нет fake iPhone shell.
16. README объясняет запуск и дальнейшие шаги.

Порядок работы:
1. Сначала проанализируй приложенный HTML/JS-прототип и выпиши коротко, какие экраны/компоненты переносишь.
2. Создай Expo/TypeScript проект, если его ещё нет.
3. Настрой expo-router.
4. Создай theme tokens.
5. Создай базовые UI-компоненты.
6. Создай mock data.
7. Реализуй 5 основных табов.
8. Реализуй вложенные routes.
9. Реализуй Hebcal/Supabase/Contacts/Notifications abstraction layers.
10. Создай Supabase migration и документацию.
11. Проверь, что TypeScript и Expo не падают.
12. В конце дай отчёт:
   - какие файлы созданы
   - какие экраны готовы
   - как запустить
   - что пока mock
   - что уже готово для Postgres/Supabase
   - что уже готово для Hebcal
   - что нужно делать следующим PR.
