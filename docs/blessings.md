# Blessings catalog

## Why local

The blessings MVP uses a local offline-first catalog. Blessings are reference content, not community data, so the app should be able to search and resolve common blessing flows without network access.

For the MVP, blessings do not live in Supabase. This PR intentionally does not add migrations, database tables, RPC, manifest sync, remote sync, SQLite, or service-role access for blessings. Supabase remains responsible for existing app data such as events; the blessings foundation is a separate local layer.

## Entry card

This entry-card PR adds only the "Благословения" card to the "Молитвы" tab. The full `/prayers/blessings` screen, search UI, direct blessing cards, modal flows, and blessing text presentation will be handled in separate PRs.

## Start screen

The start-screen PR adds the `/prayers/blessings` route with a dark glassmorphism landing screen for the blessings section. It includes a back button, title, subtitle, controlled search field, and quick access groups.

Quick access content must come from `listHomeBlessings()` in `src/services/blessingsCatalogService.ts`; UI should only own group labels and layout. Search results, item schemes, direct blessing cards, dynamic inserts, and the blessing text modal remain separate PRs.

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

The calendar helper does not store or render insertion texts. Those texts belong in the local blessings catalog and will be connected in a later PR.

Shabbat and Yom Tov are intentionally not included in MVP runtime flags. Blessings MVP also continues to avoid Supabase blessings tables, migrations, SQLite, remote sync, and RPC.

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
