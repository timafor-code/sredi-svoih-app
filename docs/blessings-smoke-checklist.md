# Blessings smoke checklist

Manual checklist for the local blessings MVP stabilization pass. This file is documentation only; do not add a Jest runner, new dependencies, Supabase storage, SQLite, migrations, or remote sync for these checks.

Before opening a PR, run `npm run validate:blessings`. Errors block the PR; warnings require review before the manual smoke pass.

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
- `манная каша` -> item `semolina_porridge`; note says `Жидкая, которую пьют, — Шеhаколь. Густая, которую едят ложкой или жуют, — Мезонот.`
- `суши` -> item `sushi`
- `фалафель` -> item `falafel`
- `смузи` -> item `smoothie`
- `молоко` -> item `milk`
- `сыр` -> item `cheese`
- `шницель` -> item `schnitzel`
- `абрикос` -> item `apricot`; first step `bore_pri_haetz`; note mentions урюк and абрикосовое повидло.
- `ананас` -> item `pineapple`; first step `bore_pri_haadama`; note says hаэц said by mistake is valid.
- `рис` -> item `rice`; first step `shehakol`; condition/dispute note keeps the case cautious.
- `рахат-лукум` -> item `rahat_lukum`; first step `shehakol`.
- `редька` -> item `black_radish`; note mentions the very bitter case.
- `суп с лапшой` -> item `noodle_soup`; first step `bore_minei_mezonot`; condition says noodles must be significant.
- `уксус` -> item `vinegar`; item is `complex` with diluted, undrinkable, and wine-vinegar scenarios.
- `фалафель из порошка` -> item `falafel_powder`; first step `shehakol`.
- `цитрон` -> item `citron`; item is conditional and notes raw/jam/povidlo forms.
- `чипсы` -> item `potato_chips`; item is conditional by slices vs powder/flour.
- `шакшука` -> item `shakshuka`; item is conditional by majority.
- `ячмень зерна` -> item `barley_kernels`; first step `shehakol`.
- `пицца` -> item `pizza`; item is `complex` with water-dough, juice/egg-dough, and meal-size scenarios.
- `вода` -> item `water`; condition includes `drink_for_thirst_or_pleasure`.
- `мейн шалош` -> blessing `mein_shalosh`; display mode is `variants`.

## Search typo tolerance

In `/prayers/blessings`, type each typo or spacing variant and confirm the first result:

- `хлею` -> item `bread`
- `маная каша` -> item `semolina_porridge`
- `виногрдный сок` -> item `grape_juice`
- `рахат лукум` -> item `rahat_lukum`
- `мейн шалош` -> blessing `mein_shalosh`
- `шеколь` -> blessing `shehakol`
- `шеакол` -> blessing `shehakol`

Confirm fuzzy hints are visible only for typo matches:

- `хлею` -> `Хлеб` with fuzzy hint.
- `маная каша` -> `Манная каша` with fuzzy hint.
- `виногрдный сок` -> `Виноградный сок` with fuzzy hint.
- `хлеб` -> `Хлеб` without fuzzy hint.
- `шеакол` -> `Шеhаколь`; direct blessing opens as before.

Confirm exact product queries still rank item results first:

- `хлеб` -> item `bread`
- `вода` -> item `water`
- `вино` -> item `wine`
- `печенье` -> item `cookies`

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

Expected result: the full text modal opens immediately. Neutral placeholder wording is acceptable where a language is unavailable; do not expect real long religious text in every MVP entry.

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
- `манная каша`
- `смузи`
- `суши`
- `фалафель`
- `шницель`
- `гранола`
- `овощной салат`
- `томатный соус`
- `уксус`
- `цитрон`
- `чолнт`
- `шакшука`
- `шпинат`

Expected result: the item scheme shows condition/dispute notes under `Условия и спорные случаи` where applicable.

## Language tabs

- Open any modal from quick access, a direct blessing, and an item scheme step.
- Switch between Russian, Hebrew, and transliteration tabs.
- Confirm only one language tab is active at a time.
- Confirm missing/placeholder content shows neutral unavailable-copy instead of a crash, blank modal, or verification warning.

## iPhone: Биркат hамазон Хабад Hebrew

1. Open `Молитвы` -> `Благословения`.
2. Open `Биркат hамазон`.
3. Select `Хабад` -> `Иврит`.
4. Confirm the Tachanun UI is a compact iOS-style switch.
5. Toggle Tachanun ON/OFF.
6. Confirm both Tachanun/no-Tachanun prefaces do not appear together.
7. Confirm the reader mode button is still present.
8. Open `Зимун`.
9. Confirm role labels appear: `Ведущий`, `Отвечают`, `Те, кто ел, отвечают`, `Те, кто не ел, отвечают`.
10. Confirm role labels are styled as annotations, not Hebrew text.
11. Confirm Hebrew text remains RTL and with nikud.
12. Open reader mode.
13. Open `Зимун` in reader mode.
14. Confirm role labels also display correctly in reader mode.
15. Confirm font-size controls still work.
16. Confirm `Русский` placeholder.
17. Confirm `Транслит` placeholder.
18. Confirm `Бейт Сфаради` placeholder.
19. Confirm no dev insert test chips are visible.
20. Confirm no warning about test, verification, future checked text, or source review is visible.
21. Confirm the annotation toggle still works.
22. Confirm manual sections are collapsed by default.
23. Expand/collapse `Добавления после брит милы`.
24. Expand/collapse `Шева брахот`.

If the real Hebcal date has a relevant flag, the corresponding insert should appear automatically. On an ordinary day, Hanukkah, Purim, Rosh Chodesh, and Chol hа-Moed insert blocks should not appear.

## Transliteration nusach split

- Open `Амоци`.
- Select `Транслит`.
- Confirm the `Сефард` / `Ашкеназ` segmented control is visible.
- Confirm `Сефард` shows the existing transliteration text.
- Confirm `Ашкеназ` shows `Ашкеназская транслитерация пока недоступна.`
- Repeat the same `Транслит` -> `Сефард` / `Ашкеназ` check for `Шеhаколь`, `hагафен`, and `Боре нефашот`.
- Confirm `Иврит` and `Русский` do not show the nusach tabs.

## Mein Shalosh

- Tap quick access `Мейн Шалош` and confirm it opens the general `mein_shalosh` entry with three variants.
- Confirm the quick access version shows all three blocks: `Аль hамихья`, `Аль hагефен`, and `Аль hаэц`.
- Search/tap `инжир`, `виноград`, `финики`, `оливки`, or `гранат`; confirm the after-blessing step is `mein_shalosh_al_haetz`.
- Search/tap `вино` or `виноградный сок`; confirm the after-blessing step is `mein_shalosh_al_hagefen`.
- Search/tap `печенье`, `торт`, or `крекер`; confirm the after-blessing step is `mein_shalosh_al_hamichya`.

## Dynamic inserts

These are service-level checks and can be verified with a temporary local dev console/script if needed:

- `getBlessingText('birkat_hamazon', { calendarFlags: ['hanukkah'], language: 'he', selectedTextNusach: 'chabad' })` should include `al_hanisim_opening_he` and `al_hanisim_hanukkah_he`.
- `getBlessingText('birkat_hamazon', { calendarFlags: ['purim'], language: 'he', selectedTextNusach: 'chabad' })` should include `al_hanisim_opening_he` and `al_hanisim_purim_he`.
- `getBlessingText('birkat_hamazon', { calendarFlags: ['rosh_chodesh'], language: 'he', selectedTextNusach: 'chabad' })` should include `יעלה ויבוא` with `רֹאשׁ הַחֹדֶשׁ`, Rosh Chodesh hАрахаман, and `מִגְדּוֹל`.
- `getBlessingText('birkat_hamazon', { calendarFlags: ['chol_hamoed_pesach'], language: 'he', selectedTextNusach: 'chabad' })` should include `יעלה ויבוא` with `חַג הַמַּצּוֹת` and `מִגְדּוֹל`.
- `getBlessingText('birkat_hamazon', { calendarFlags: ['chol_hamoed_sukkot'], language: 'he', selectedTextNusach: 'chabad' })` should include `יעלה ויבוא` with `חַג הַסֻּכּוֹת`, Sukkot hАрахаман, and `מִגְדּוֹל`.
- `getBlessingText('rainbow', { calendarFlags: ['hanukkah'] })` should not include an insert block.
- `getBlessingText('birkat_hamazon', { calendarFlags: [], language: 'he', selectedTextNusach: 'chabad' })` should not include `Аль hанисим` or `יעלה ויבוא` and should use `מַגְדִּיל`.
- `getBlessingText('birkat_hamazon', { calendarFlags: [], language: 'he', selectedTextNusach: 'beit_sefaradi' })` should keep the Beit Sefaradi placeholder behavior.
