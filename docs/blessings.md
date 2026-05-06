# Blessings catalog

## Why local

The blessings MVP uses a local offline-first catalog. Blessings are reference content, not community data, so the app should be able to search and resolve common blessing flows without network access.

For the MVP, blessings do not live in Supabase. This PR intentionally does not add migrations, database tables, RPC, manifest sync, remote sync, SQLite, or service-role access for blessings. Supabase remains responsible for existing app data such as events; the blessings foundation is a separate local layer.

## Entry card

This entry-card PR adds only the "Благословения" card to the "Молитвы" tab. The full `/prayers/blessings` screen, search UI, direct blessing cards, modal flows, and blessing text presentation will be handled in separate PRs.

## Start screen

The start-screen PR adds the `/prayers/blessings` route with a dark glassmorphism landing screen for the blessings section. It includes a back button, title, subtitle, controlled search field, and quick access groups.

Quick access content must come from `listHomeBlessings()` in `src/services/blessingsCatalogService.ts`; UI should only own group labels and layout. Search results, item schemes, direct blessing cards, dynamic inserts, and the blessing text modal remain separate PRs.

## Search and schemes

The search-and-schemes PR connects the `/prayers/blessings` screen to the local `searchBlessings()` service. Non-empty search input now renders real local search results for products/situations and direct blessing entries.

When a product result is selected, the screen resolves details through `getBlessingItemDetails()` and displays the local `item -> pattern -> steps` scheme. Conditional and complex products show "Есть условия" badges plus condition/dispute notes from the catalog.

This PR still does not add direct blessing cards, blessing text modals, full blessing text, dynamic inserts, Zustand state, Supabase storage, migrations, SQLite, or remote sync. Tapping a direct blessing or a scheme step intentionally shows a placeholder alert until those flows are added in later PRs.

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

Existing `contentBlocks` with `language: 'translit'` and no `translitNusach` are treated as the Sephard fallback, so previously added transliteration continues to render without catalog churn.

Ashkenaz transliteration blocks will be added in separate small PRs after source review. Until then, missing Ashkenaz transliteration renders a soft placeholder.

This PR does not add new blessing texts, change Supabase, add migrations, add SQLite, or introduce remote sync.

## Model

The catalog uses a compact pattern-based model:

```text
item -> pattern -> blessings + conditions + disputes/notes
```

Products stay short. A product points to a reusable pattern, and the pattern owns the ordered blessing steps.

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

Current insert blocks are placeholders only and must keep `needsVerification: true`. Real Hanukkah, Purim, Rosh Chodesh, Chol hа-Moed Pesach, and Chol hа-Moed Sukkot texts should be added only after checking reliable sources.

This insert infrastructure does not add Supabase blessing storage, migrations, SQLite, remote sync, manifest sync, or service-role access. Shabbat and Yom Tov runtime flags are still intentionally not included.

## Stabilization pass

The original 9-PR `blessings4.txt` chain is complete and merged as PR #62-#70. This stabilization pass keeps the scope small: the catalog works locally, the `/prayers/blessings` screen resolves quick access rows, item schemes, direct blessing results, the shared modal, and placeholder dynamic inserts without adding a remote blessings backend.

Search ranking is intentionally lightweight. `searchBlessings()` normalizes the query, then ranks exact matches above `startsWith`, `includes`, and reverse-contains matches. When scores tie, item results stay ahead of direct blessing entries so common product queries like "хлеб", "вода", "печенье", "вино", and "виноградный сок" open product schemes first.

Complex products remain cautious. Items whose blessing depends on preparation, main ingredient, grain content, mixed-food rules, or food form should stay marked with `complexity: 'conditional'`, `needsVerification: true`, and reusable condition/dispute keys until they are reviewed.

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
4. If the case is conditional, use `patternKey: 'conditional'`, set `complexity: 'conditional'`, and add `conditionKeys` or `disputeKeys`.
5. Do not duplicate blessing steps inside the item.

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

Home quick access uses the general `mein_shalosh` slug because the user tapped "Мейн Шалош" directly and the product context is unknown.

Product patterns must use concrete variants:

- `mezonot_al_hamichya` -> `mein_shalosh_al_hamichya`
- `wine_grape` -> `mein_shalosh_al_hagefen`
- `seven_species_fruit` -> `mein_shalosh_al_haetz`

The general `mein_shalosh` blessing should show all three variants with labels:

- Аль hамихья - after mezonot / baked goods
- Аль hагефен - after wine / grape juice
- Аль hаэц - after seven-species fruit

## Text verification

This foundation intentionally does not include long religious texts. Real blessing text, nusach differences, inserts, and source links require review. Keep `needsVerification: true` for placeholder content and for any case that still needs halachic/source validation.
