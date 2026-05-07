# Blessings catalog

## Why local

The blessings MVP uses a local offline-first catalog. Blessings are reference content, not community data, so the app should be able to search and resolve common blessing flows without network access.

For the MVP, blessings do not live in Supabase. This PR intentionally does not add migrations, database tables, RPC, manifest sync, remote sync, SQLite, or service-role access for blessings. Supabase remains responsible for existing app data such as events; the blessings foundation is a separate local layer.

## Source Alignment

The food catalog is being aligned to "Руководство по благословениям" Рабби Шнеур-Залман из Ляд, a local reference for Chabad custom / Alter Rebbe psak. The current source range covered by the catalog pass is the visible alphabetical block `А-Я`.

Disclaimer for the catalog:

- The instructions concern foods that are in an edible state.
- The foods are prepared and eaten in their usual way.
- The foods are being eaten separately from other dishes unless the item explicitly says otherwise.
- The order follows Chabad custom according to the tables of rabbis Ch. Pruss and Y. Green.

The catalog should remain compact:

```text
item -> pattern -> blessings + conditions + notes/disputes
```

Most products should use a compact tuple:

```ts
['apricot', 'Абрикос', 'haetz_bore_nefashot', ['абрикос']]
```

Use tuple `options` only when the item has a condition, footnote, source reference, dispute, alternative scenario, or needs a cautious badge.

## Source notes

Source footnotes must not be folded into `titleRu`. Put them into reusable `noteKeys` and define the text in `src/data/blessings/notes.ts`.

Use:

- `noteKeys` for short source footnotes and ordinary clarifications.
- `conditionKeys` when the user must know a condition before applying the result.
- `disputeKeys` and `complexity: 'conditional' | 'complex'` when the case is composition-sensitive, disputed, or should not be shown as a simple automatic psak.
- `sourceRefs` for compact references such as `Brachas.txt: Пицца 796`.

UI may show product notes as small text near the item scheme. Conditional products should show a badge like `Есть условия`; complex or disputed cases should show `Спорный случай` or equivalent copy.

## Catalog validation

Run the local validation harness before opening a PR that changes the blessings catalog:

```sh
npm run validate:blessings
```

The validator imports the offline catalog and service, checks entity uniqueness, required fields, pattern/item references, condition/note/dispute keys, source references, alias integrity, and search smoke cases. Errors block the PR and must be fixed. Warnings do not fail the command, but they require review; alias collisions are intentionally warnings so shared terms can be checked manually.

## Alias warning review

Reviewed on 2026-05-07 for `npm run validate:blessings`. The reviewed collisions are exact alias + owner-set pairs in `allowedAliasCollisions`; a new owner for the same alias or a new alias collision should still warn.

Intentional product/direct-blessing collisions:

- `картофель`: `item:potato` and `blessing:bore_pri_haadama`
- `хлеб`, `хала`: `item:bread` and `blessing:hamotzi`
- `печенье`: `item:cookies` and `blessing:bore_minei_mezonot`
- `торт`: `item:cake` and `blessing:bore_minei_mezonot`
- `вода`: `item:water` and `blessing:shehakol`
- `чай`: `item:tea` and `blessing:shehakol`
- `кофе`: `item:coffee` and `blessing:shehakol`
- `вино`: `item:wine` and `blessing:bore_pri_hagafen`
- `виноградный сок`: `item:grape_juice` and `blessing:bore_pri_hagafen`

These are allowed because a common food/drink term may reasonably find both the item scheme and the direct before-blessing card. Search ranking should keep item results first for these product queries.

Intentional `Мейн Шалош` general/variant collisions:

- `ал хамихья`, `аль hамихья`, `ал hамихья`: `blessing:mein_shalosh` and `blessing:mein_shalosh_al_hamichya`
- `аль hагефен`, `ал hагефен`: `blessing:mein_shalosh` and `blessing:mein_shalosh_al_hagefen`
- `аль hаэц`, `ал hаэц`: `blessing:mein_shalosh` and `blessing:mein_shalosh_al_haetz`

These are allowed because the general `Мейн Шалош` entry is a variants landing point, while the specific variants are still needed for item schemes and direct lookup.

No accidental or ambiguous alias collisions were found in this review.

## Entry card

This entry-card PR adds only the "Благословения" card to the "Молитвы" tab. The full `/prayers/blessings` screen, search UI, direct blessing cards, modal flows, and blessing text presentation will be handled in separate PRs.

## Start screen

The start-screen PR adds the `/prayers/blessings` route with a dark glassmorphism landing screen for the blessings section. It includes a back button, title, subtitle, controlled search field, and quick access groups.

Quick access content must come from `listHomeBlessings()` in `src/services/blessingsCatalogService.ts`; UI should only own group labels and layout. Search results, item schemes, direct blessing cards, dynamic inserts, and the blessing text modal remain separate PRs.

## Search and schemes

The search-and-schemes PR connects the `/prayers/blessings` screen to the local `searchBlessings()` service. Non-empty search input now renders real local search results for products/situations and direct blessing entries.

When a product result is selected, the screen resolves details through `getBlessingItemDetails()` and displays the local `item -> pattern -> steps` scheme. Conditional and complex products show "Есть условия" badges plus condition/dispute notes from the catalog.

This PR still does not add direct blessing cards, blessing text modals, full blessing text, dynamic inserts, Zustand state, Supabase storage, migrations, SQLite, or remote sync. Tapping a direct blessing or a scheme step intentionally shows a placeholder alert until those flows are added in later PRs.

## Search typo tolerance

`searchBlessings()` remains the only search boundary for the UI. The UI should pass the user's text and render returned results; it should not duplicate normalization, fuzzy matching, or ranking.

Search normalization is intentionally small and local:

- trims leading/trailing whitespace;
- lowercases Russian and English text;
- maps `ё` to `е`;
- treats hyphens and underscores as word separators, so `рахат-лукум`, `рахат лукум`, and slug-like input normalize consistently;
- collapses repeated whitespace;
- removes extra punctuation while preserving Russian, English, Hebrew letters, and numbers.

Ranking keeps the previous priority:

- exact alias/title/slug match: highest;
- `startsWith`;
- `includes`;
- fuzzy typo match with a low score;
- reverse-contains for longer field values.

The fuzzy layer is a bounded Levenshtein check with no dependencies. It only runs after stronger field matches fail, only for normalized strings of at least 4 characters, and allows distance 1 for short words or 2 for longer strings. This is enough for small typos such as `хлею`, `маная каша`, and `виногрдный сок`, while exact product aliases still outrank blessing aliases. On equal score, item results remain above direct blessing results so product queries like `хлеб`, `вода`, `вино`, and `печенье` open item schemes first.

Search results include lightweight match metadata for the UI. Fuzzy results may show a small muted hint such as "Найдено по похожему запросу" or "Похоже на: <matchedText>"; exact, starts-with, includes, and reverse-contains results do not show an extra hint.

## Direct card

The direct-card PR renders direct blessing search results on `/prayers/blessings` without leaving the screen. Selecting a direct blessing such as "Радуга", "Молния", "Гром", "Ашер яцар", or "Шеhехеяну" now shows a `BlessingDirectCard` below the search results instead of the old placeholder alert.

The card uses local `getBlessingText()` data only, keeps a single active language tab visible at a time, and shows gentle placeholder copy when Hebrew, transliteration, or checked Russian text is not available yet. Verification notices stay soft because most catalog text is still pending source review.

This PR still does not add the shared `BlessingTextModal`, dynamic inserts, Supabase storage, migrations, SQLite, remote sync, or any source-text expansion. Those flows remain separate small PRs.

## Full text modal

The full-text-modal PR adds the shared controlled `BlessingTextModal` for `/prayers/blessings`. It opens local `getBlessingText()` results from quick access rows, the direct blessing card's "Открыть полный текст" button, and item scheme steps.

The modal keeps the same local catalog boundary as the previous blessings MVP work: it shows only the selected language tab, scrolls inside a dark glass panel for future long texts, and displays verification placeholders when a language is not ready. Dynamic inserts for Birkat Hamazon and Mein Shalosh remain a separate PR and are not rendered or assembled here.

## Core short blessing texts

This PR adds short core blessing text blocks for basic before-food and after-food blessings in Hebrew, transliteration, and Russian.

Long Birkat Hamazon and Mein Shalosh texts remain separate PRs.

Holiday inserts remain a separate PR.

Texts that keep `needsVerification: true` still require final rabbinic/source review before they are treated as approved.

## Transliteration nusach split

The main blessing language tabs stay the same: `Иврит`, `Транслит`, and `Русский`.

Inside `Транслит`, the UI now shows a secondary segmented control for `Сефард` and `Ашкеназ`.

Core short blessings now have explicit `translit_sephard` and `translit_ashkenaz` blocks.

`translit_sephard` currently carries the previously existing transliteration as a temporary fallback.

`translit_ashkenaz` is placeholder-only until it is manually filled and reviewed.

No new religious text was authored by Codex in this PR.

This PR does not add new blessing texts, change Supabase, add migrations, add SQLite, or introduce remote sync.

## Model

The catalog uses a compact pattern-based model:

```text
item -> pattern -> blessings + conditions + disputes/notes
```

Products stay short. A product points to a reusable pattern, and the pattern owns the ordered blessing steps.

Canonical food patterns now include:

- `hamotzi_meal`
- `mezonot_al_hamichya`
- `mezonot_bore_nefashot`
- `haetz_bore_nefashot`
- `seven_species_fruit`
- `haadama_bore_nefashot`
- `shehakol_bore_nefashot`
- `hagafen_al_hagefen`
- `drink_shehakol`
- `conditional`
- `complex`
- `no_bracha`

Example:

```ts
['fig', 'Инжир', 'seven_species_fruit', ['инжир', 'фига', 'fig', 'תאנה']]
```

The order for all seven-species fruit is stored once in `patterns.ts`:

```text
seven_species_fruit -> bore_pri_haetz -> mein_shalosh_al_haetz
```

UI should not expand patterns directly. Use `src/services/blessingsCatalogService.ts`.

## Food catalog expansion

This PR expands only the local food item catalog, aliases, reusable conditions, and reusable dispute notes for the blessings section.

Products still use the pattern-based model:

```text
item -> pattern -> blessings
```

Items do not duplicate blessing steps. A product points to `patternKey`, and reusable patterns continue to own the blessing flow.

Complex or composition-sensitive foods are marked with `complexity: 'conditional'`, `conditionKeys`, optional `disputeKeys`, and `needsVerification: true`. The catalog should stay cautious for cases that depend on the main ingredient, grain content, preparation, food form, or mixed-food rules.

The UI does not hardcode these products. `/prayers/blessings` should discover them through `searchBlessings()`, and search matching uses the item's `aliases` for common Russian, English, and short Hebrew variants.

Real psak decisions, long blessing texts, source links, and nusach-specific wording still require review before they are added.

## Files

- `src/types/blessing.ts` - shared catalog types.
- `src/data/blessings/blessings.ts` - direct blessing entries and home quick access metadata.
- `src/data/blessings/patterns.ts` - reusable blessing flows.
- `src/data/blessings/conditions.ts` - reusable conditional notes.
- `src/data/blessings/disputes.ts` - known disputed or ask-rav cases.
- `src/data/blessings/items/*.ts` - compact item tuples by category.
- `src/data/blessings/catalog.ts` - assembled local catalog.
- `src/services/blessingsCatalogService.ts` - search, lookup, text, and pattern resolution API.

## Календарные флаги

`src/lib/jewishCalendarFlags.ts` is a local Hebcal-based helper for future Birkat Hamazon and Mein Shalosh insert handling. It returns only stable flag codes:

- `hanukkah`
- `purim`
- `rosh_chodesh`
- `chol_hamoed_pesach`
- `chol_hamoed_sukkot`

The calendar helper does not store or render insertion texts. Those texts belong in the local blessings catalog and are assembled through local dynamic insert rules.

Shabbat and Yom Tov are intentionally not included in MVP runtime flags. Blessings MVP also continues to avoid Supabase blessings tables, migrations, SQLite, remote sync, and RPC.

## Dynamic inserts

Dynamic inserts stay fully local. `resolveJewishCalendarFlags()` returns only calendar flags; it does not choose wording and does not render religious text.

`getBlessingText()` applies `dynamicInsertRules` from the local blessing entry and returns a `BlessingTextResult` whose `contentBlocks` are already assembled for UI. `BlessingTextModal` and direct cards should render `textResult.contentBlocks` as-is instead of applying insert rules themselves.

Birkat hамазон Хабад now uses inline source blocks for the verified-source Hebrew map, so its Hanukkah, Purim, Rosh Chodesh, Chol hа-Moed Pesach, and Chol hа-Moed Sukkot insert blocks come from the local content blocks rather than placeholder insert rules. Other long texts may still use placeholder dynamic insert rules until their source text is added.

This insert infrastructure does not add Supabase blessing storage, migrations, SQLite, remote sync, manifest sync, or service-role access. Shabbat and Yom Tov runtime flags are still intentionally not included.

## Birkat hамазон Хабад Hebrew

`src/data/blessings/longTexts/birkatHamazon.ts` now includes `birkatHamazonChabadHebrewBlocks`, copied from `habad-heb.md`. The blocks contain vocalized Hebrew from the Chabad.org PDF 92404 / Siddur Tehilat Hashem source map, plus Russian annotations for instructions. The Chabad variant carries:

- `sourceName: Siddur Tehilat Hashem / Chabad.org PDF`
- `sourceUrl: https://w2.chabad.org/media/pdf/92404.pdf`
- `needsVerification: true`

This PR adds Hebrew only. Russian translation of the main text, Sephardic transliteration, and Ashkenazic transliteration are not included. The Beit Sefaradi nusach remains a placeholder.

The Hebrew reader/runtime pass keeps that scope and adds only working-reader controls for the Chabad Hebrew variant:

- manual preface selector: no preface, Tachanun-day preface, or no-Tachanun-day preface;
- Hebcal insert rendering from local content blocks;
- dev-only insert test controls inside `BlessingTextModal` for Hanukkah, Purim, Rosh Chodesh, Chol hа-Moed Pesach, and Chol hа-Moed Sukkot;
- white fullscreen reader mode with black RTL Hebrew, local font-size controls, and an annotations toggle;
- shared collapsed/expanded state for manual sections between the dark modal and reader mode.

Shabbat and Yom Tov are still not runtime in the MVP. Transliteration and Russian translation of the main Birkat hамазон text are still not added.

Runtime Hebcal inserts are limited to:

- Hanukkah: `al_hanisim_opening_he` + `al_hanisim_hanukkah_he`
- Purim: `al_hanisim_opening_he` + `al_hanisim_purim_he`
- Rosh Chodesh: `yaale_veyavo_he` with `רֹאשׁ הַחֹדֶשׁ`, Rosh Chodesh hАрахаман, and `מִגְדּוֹל`
- Chol hа-Moed Pesach: `yaale_veyavo_he` with `חַג הַמַּצּוֹת` and `מִגְדּוֹל`
- Chol hа-Moed Sukkot: `yaale_veyavo_he` with `חַג הַסֻּכּוֹת`, Sukkot hАрахаман, and `מִגְדּוֹל`

Shabbat, Yom Tov, Rosh Hashanah, Shemini Atzeret, and omitted-insert instruction blocks are retained only as source-map/future material and are not shown by runtime MVP logic.

Manual sections are rendered collapsed by default in the text modal:

- Зимун
- Зимун на свадьбе / Шева брахот
- Добавления после брит милы
- Шева брахот
- Благословение на бокал вина

Hebrew text in `BlessingTextModal` uses a larger RTL siddur-like style and an iOS system serif fallback (`Times New Roman`) when available. No font assets are bundled in this PR. If iPhone smoke shows that the fallback is not stable enough, add a separate licensed Hebrew serif font in a future PR after license review; do not commit arbitrary `.ttf` or `.otf` files.

All newly added religious text blocks remain `needsVerification: true` pending final source/rabbinic and rights review.

## Stabilization pass

The original 9-PR `blessings4.txt` chain is complete and merged as PR #62-#70. This stabilization pass keeps the scope small: the catalog works locally, the `/prayers/blessings` screen resolves quick access rows, item schemes, direct blessing results, the shared modal, and placeholder dynamic inserts without adding a remote blessings backend.

Search ranking is intentionally lightweight. `searchBlessings()` normalizes the query, then ranks exact matches above `startsWith`, `includes`, and reverse-contains matches. When scores tie, item results stay ahead of direct blessing entries so common product queries like "хлеб", "вода", "печенье", "вино", and "виноградный сок" open product schemes first.

Complex products remain cautious. Items whose blessing depends on preparation, main ingredient, grain content, mixed-food rules, or food form should stay marked with `complexity: 'conditional'`, `needsVerification: true`, and reusable condition/dispute keys until they are reviewed.

The `Р-Я` catalog pass adds exact source-backed entries for the remaining alphabetical block and keeps cases such as salads, soups, vinegar, citron, chips, cholent, shakshuka, schnitzel, and spinach conditional when the source depends on composition or preparation.

Real religious texts are still a separate source-verification task. Current long-text surfaces and calendar inserts use short placeholders only, and dynamic inserts should remain placeholders until reliable sources and nusach handling are checked.

Direct blessing search results such as "Радуга", "Молния", "Гром", "Ашер яцар", and "Шеhехеяну" should open `BlessingTextModal` immediately after selection. `BlessingDirectCard` can remain as a contextual summary/full-text entry point while the modal flow is active.

Possible next PRs:

- Verified blessing texts.
- Search typo tolerance.
- Duplicate/alias review.
- Favorites/recent blessings.
- Source attribution screen.
- Rabbinic review workflow.

## Add a product

1. Choose the correct item category file under `src/data/blessings/items/`.
2. Add a compact tuple:

```ts
['apple', 'Яблоко', 'tree_fruit_regular', ['яблоко', 'apple'], { category: 'fruits' }]
```

3. Reuse an existing pattern whenever possible.
4. If the case has a source footnote, add `noteKeys` and define the note in `notes.ts`.
5. If the case is conditional, use `patternKey: 'conditional'` or the most likely base pattern, set `complexity: 'conditional'`, and add `conditionKeys`, `noteKeys`, or `disputeKeys`.
6. If the case has multiple real alternatives, use `patternKey: 'complex'`, `complexity: 'complex'`, and describe the alternatives through notes/conditions/disputes.
7. If no blessing is said, use `patternKey: 'no_bracha'` and explain the reason through `conditionKeys` or `noteKeys`.
8. Do not duplicate blessing steps inside the item.

## Add a direct blessing

1. Add an entry to `src/data/blessings/blessings.ts`.
2. Include `slug`, `titleRu`, `category`, `displayMode`, `aliases`, and `needsVerification`.
3. Use short placeholder `contentBlocks` until the real text is checked from a reliable source.
4. Add `home` only if the blessing belongs in quick access.

## Add a disputed case

1. Add a `BlessingDispute` entry in `src/data/blessings/disputes.ts`.
2. Mark `severity` as `info`, `ask_rav`, or `machloket`.
3. Attach it to products through `disputeKeys`.
4. Keep `needsVerification: true` until the note is reviewed.

## Mein Shalosh rule

Home quick access uses the general `mein_shalosh` slug because the user tapped "Мейн Шалош" directly and the product context is unknown. In that case the UI should show all three variants:

- `Аль hамихья`
- `Аль hагефен`
- `Аль hаэц`

Product patterns must use concrete variants:

- `mezonot_al_hamichya` -> `mein_shalosh_al_hamichya`
- `wine_grape` -> `mein_shalosh_al_hagefen`
- `seven_species_fruit` -> `mein_shalosh_al_haetz`

When the user reaches Mein Shalosh from a concrete product, show only the concrete `blessingSlug` resolved from the product pattern:

- Аль hамихья - after mezonot / baked goods
- Аль hагефен - after wine / grape juice
- Аль hаэц - after seven-species fruit

## Text verification

This foundation intentionally does not include long religious texts. Real blessing text, nusach differences, inserts, and source links require review. Keep `needsVerification: true` for placeholder content and for any case that still needs halachic/source validation.
