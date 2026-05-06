# Blessings smoke checklist

Manual checklist for the local blessings MVP stabilization pass. This file is documentation only; do not add a Jest runner, new dependencies, Supabase storage, SQLite, migrations, or remote sync for these checks.

## Search ranking

In `/prayers/blessings`, type each query and confirm the first result:

- `хлеб` -> item `bread`
- `хала` -> item `bread`
- `инжир` -> item `fig`
- `вино` -> item `wine`
- `виноградный сок` -> item `grape_juice`
- `печенье` -> item `cookies`
- `вода` -> item `water`
- `радуга` -> blessing `rainbow`
- `туалет` -> blessing `asher_yatzar`
- `новый плод` -> blessing `shehecheyanu`
- `мейн шалош` -> blessing `mein_shalosh`
- `банан` -> item `banana`
- `авокадо` -> item `avocado`
- `клубника` -> item `strawberry`
- `грибы` -> item `mushroom`
- `овсянка` -> item `oatmeal`
- `суши` -> item `sushi`
- `фалафель` -> item `falafel`
- `смузи` -> item `smoothie`
- `молоко` -> item `milk`
- `сыр` -> item `cheese`
- `шницель` -> item `schnitzel`

## Alias overlaps

Check that known overlaps do not hide the expected first result:

- `cornflakes`, `corn flakes`, `кукурузные хлопья` -> `cornflakes`
- `хлопья из кукурузы` -> `cornflakes_grain`
- `гранола`, `granola` -> `granola`
- `granola cereal`, `гранола сухой завтрак` -> `granola_cereal`
- `йогурт`, `yogurt` -> `yogurt`
- `питьевой йогурт`, `yogurt drink` -> `yogurt_drink`
- `виноград`, `grape`, `grapes` -> `grapes`
- `grape juice`, `виноградный сок` -> `grape_juice`

## Quick access

- Open the screen with an empty search query.
- Confirm the quick access label reads `Быстрый доступ · Нажмите, чтобы открыть текст`.
- Tap before-food, after-food, and various quick access rows.
- Confirm each row opens `BlessingTextModal` without leaving the screen.

## Direct blessings

Search and tap each direct blessing:

- `радуга`
- `молния`
- `гром`
- `туалет`
- `новый плод`

Expected result: the full text modal opens immediately. Placeholder or verification wording is acceptable; do not expect real long religious text in this MVP pass.

## Item schemes

Search and tap product results for:

- `хлеб`
- `печенье`
- `инжир`
- `вино`
- `вода`
- `банан`
- `овсянка`
- `суши`

Expected result: product details render the item scheme with ordered blessing steps. Tapping a step opens `BlessingTextModal`.

## Conditional items

Search and open conditional products such as:

- `овсянка`
- `смузи`
- `суши`
- `фалафель`
- `шницель`
- `гранола`

Expected result: the item scheme shows condition/dispute notes under `Условия и спорные случаи`, with verification wording where applicable.

## Language tabs

- Open any modal from quick access, a direct blessing, and an item scheme step.
- Switch between Russian, Hebrew, and transliteration tabs.
- Confirm only one language tab is active at a time.
- Confirm missing/placeholder content shows a soft `Текст требует проверки` message instead of a crash or blank modal.

## Transliteration nusach split

- Open `Амоци`.
- Select `Транслит`.
- Confirm the `Сефард` / `Ашкеназ` segmented control is visible.
- Confirm `Сефард` shows the existing transliteration text.
- Confirm `Ашкеназ` shows `Ашкеназская транслитерация будет добавлена после проверки.`
- Repeat the same `Транслит` -> `Сефард` / `Ашкеназ` check for `Шеhаколь`, `hагафен`, and `Боре нефашот`.
- Confirm `Иврит` and `Русский` do not show the nusach tabs.

## Mein Shalosh

- Tap quick access `Мейн Шалош` and confirm it opens the general `mein_shalosh` entry with three variants.
- Search/tap `инжир`, `виноград`, `финики`, `оливки`, or `гранат`; confirm the after-blessing step is `mein_shalosh_al_haetz`.
- Search/tap `вино` or `виноградный сок`; confirm the after-blessing step is `mein_shalosh_al_hagefen`.
- Search/tap `печенье`, `торт`, or `крекер`; confirm the after-blessing step is `mein_shalosh_al_hamichya`.

## Dynamic inserts

These are service-level checks and can be verified with a temporary local dev console/script if needed:

- `getBlessingText('birkat_hamazon', { calendarFlags: ['hanukkah'] })` should include an insert placeholder block.
- `getBlessingText('rainbow', { calendarFlags: ['hanukkah'] })` should not include an insert block.
- `getBlessingText('birkat_hamazon', { calendarFlags: [] })` should keep the original placeholder-only behavior.
