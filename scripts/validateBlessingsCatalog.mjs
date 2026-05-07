#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const ts = require('typescript');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

registerTypeScriptRequireHook();

const { blessingsCatalog } = require(path.join(repoRoot, 'src/data/blessings/catalog.ts'));
const { normalizeBlessingQuery, searchBlessings } = require(
  path.join(repoRoot, 'src/services/blessingsCatalogService.ts'),
);

const errors = [];
const warnings = [];
const aliasWarnings = [];

const allowedEmptyPatternKeys = new Set(['conditional', 'complex', 'no_bracha', 'no_blessing']);
const conditionalPatternKeys = new Set(['conditional', 'complex']);
const allowedAliasCollisions = new Map(
  [
    ['картофель', ['blessing:bore_pri_haadama', 'item:potato']],
    ['хлеб', ['blessing:hamotzi', 'item:bread']],
    ['хала', ['blessing:hamotzi', 'item:bread']],
    ['печенье', ['blessing:bore_minei_mezonot', 'item:cookies']],
    ['торт', ['blessing:bore_minei_mezonot', 'item:cake']],
    ['вода', ['blessing:shehakol', 'item:water']],
    ['чай', ['blessing:shehakol', 'item:tea']],
    ['кофе', ['blessing:shehakol', 'item:coffee']],
    ['вино', ['blessing:bore_pri_hagafen', 'item:wine']],
    ['виноградный сок', ['blessing:bore_pri_hagafen', 'item:grape_juice']],
    ['ал хамихья', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_hamichya']],
    ['аль hамихья', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_hamichya']],
    ['ал hамихья', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_hamichya']],
    ['аль hагефен', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_hagefen']],
    ['ал hагефен', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_hagefen']],
    ['аль hаэц', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_haetz']],
    ['ал hаэц', ['blessing:mein_shalosh', 'blessing:mein_shalosh_al_haetz']],
  ].map(([alias, owners]) => [normalizeAlias(alias), formatAliasOwnersKey(owners)]),
);

const blessings = ensureArray('catalog.blessings', blessingsCatalog.blessings);
const patterns = ensureArray('catalog.patterns', blessingsCatalog.patterns);
const conditions = ensureArray('catalog.conditions', blessingsCatalog.conditions);
const notes = ensureArray('catalog.notes', blessingsCatalog.notes);
const disputes = ensureArray('catalog.disputes', blessingsCatalog.disputes);
const itemTuples = ensureArray('catalog.items', blessingsCatalog.items);
const items = itemTuples.map(expandBlessingItemTuple).filter(Boolean);

const blessingSlugs = keySet(blessings, 'slug');
const patternKeys = keySet(patterns, 'key');
const conditionKeys = keySet(conditions, 'key');
const noteKeys = keySet(notes, 'key');
const disputeKeys = keySet(disputes, 'key');

validateBlessings();
validatePatterns();
validateItems();
validateReferenceCollections();
validateAliasCollisions();
validateSearchSmokeCases();

if (errors.length > 0) {
  console.error('Blessings catalog validation failed');
  printList('Errors', errors, console.error);
  if (warnings.length > 0) {
    printList('Warnings', warnings, console.error);
  }
  printCounts();
  process.exit(1);
}

console.log('Blessings catalog validation passed');
printCounts();

if (warnings.length > 0) {
  printList('Warnings', warnings, console.log);
}

function registerTypeScriptRequireHook() {
  const originalResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function resolveBlessingsCatalogAlias(
    request,
    parent,
    isMain,
    options,
  ) {
    const resolvedRequest = request.startsWith('@/') ?
      path.join(repoRoot, 'src', request.slice(2)) :
      request;

    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  Module._extensions['.ts'] = function compileTypeScriptModule(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filename,
    });

    module._compile(outputText, filename);
  };
}

function validateBlessings() {
  validateUniqueProperty('blessings', blessings, 'slug', describeBlessing);

  for (const blessing of blessings) {
    const owner = describeBlessing(blessing);

    if (!isNonEmptyString(blessing.titleRu)) {
      addError(`${owner} is missing titleRu`);
    }

    validateAliases(owner, blessing.aliases);
    validateContentBlocks(owner, blessing.contentBlocks);
    validateNusachVariants(owner, blessing.nusachVariants);

    if (blessing.home?.enabled === true && typeof blessing.home.order !== 'number') {
      addError(`${owner} has home.enabled=true but home.order is not set`);
    }

    if (blessing.displayMode === 'variants' && !hasVariantStructure(blessing)) {
      addError(`${owner} uses displayMode=variants but has no variant content blocks`);
    }
  }
}

function validatePatterns() {
  validateUniqueProperty('patterns', patterns, 'key', describePattern);

  for (const pattern of patterns) {
    const owner = describePattern(pattern);

    if (!Array.isArray(pattern.steps)) {
      addError(`${owner} has non-array steps`);
    } else if (pattern.steps.length === 0 && !allowedEmptyPatternKeys.has(pattern.key)) {
      addError(`${owner} has empty steps but is not in the allowed empty-pattern list`);
    } else {
      pattern.steps.forEach((blessingSlug, index) => {
        if (!isNonEmptyString(blessingSlug)) {
          addError(`${owner}.steps[${index}] is empty`);
        } else if (!blessingSlugs.has(blessingSlug)) {
          addError(`${owner}.steps[${index}] references missing blessing "${blessingSlug}"`);
        }
      });
    }

    validateReferenceKeys(owner, 'conditionKeys', pattern.conditionKeys, conditionKeys);
    validateReferenceKeys(owner, 'noteKeys', pattern.noteKeys, noteKeys);
    validateReferenceKeys(owner, 'disputeKeys', pattern.disputeKeys, disputeKeys);
    validateSourceRefs(owner, pattern.sourceRefs);
  }
}

function validateItems() {
  validateUniqueProperty('items', items, 'slug', describeItem);

  for (const item of items) {
    const owner = describeItem(item);

    if (!isNonEmptyString(item.titleRu)) {
      addError(`${owner} is missing titleRu`);
    }

    if (!isNonEmptyString(item.patternKey)) {
      addError(`${owner} is missing patternKey`);
    } else if (!patternKeys.has(item.patternKey)) {
      addError(`${owner} references missing patternKey "${item.patternKey}"`);
    }

    validateAliases(owner, item.aliases);

    if (!isNonEmptyString(item.category)) {
      addWarning(`${owner} is missing category`);
    }

    validateReferenceKeys(owner, 'conditionKeys', item.conditionKeys, conditionKeys);
    validateReferenceKeys(owner, 'noteKeys', item.noteKeys, noteKeys);
    validateReferenceKeys(owner, 'disputeKeys', item.disputeKeys, disputeKeys);
    validateSourceRefs(owner, item.sourceRefs);

    const hasAnnotations =
      hasKeys(item.conditionKeys) || hasKeys(item.noteKeys) || hasKeys(item.disputeKeys);

    if (
      item.complexity === 'conditional' &&
      !hasAnnotations &&
      !conditionalPatternKeys.has(item.patternKey)
    ) {
      addError(
        `${owner} has complexity=conditional but no conditionKeys/noteKeys/disputeKeys and patternKey is not conditional/complex`,
      );
    }

    if (item.complexity === 'complex') {
      if (!hasAnnotations) {
        addError(`${owner} has complexity=complex but no conditionKeys/noteKeys/disputeKeys`);
      } else if (!hasKeys(item.noteKeys) && !hasKeys(item.disputeKeys)) {
        addWarning(`${owner} has complexity=complex without noteKeys or disputeKeys`);
      }
    }
  }
}

function validateReferenceCollections() {
  validateKeyedCollection('conditions', conditions, describeCondition);
  validateKeyedCollection('notes', notes, describeNote);
  validateKeyedCollection('disputes', disputes, describeDispute);
}

function validateKeyedCollection(collectionName, collection, describe) {
  validateUniqueProperty(collectionName, collection, 'key', describe);

  for (const entity of collection) {
    const owner = describe(entity);

    if (!isNonEmptyString(entity.titleRu)) {
      addError(`${owner} is missing titleRu`);
    }

    if ('descriptionRu' in entity && !isNonEmptyString(entity.descriptionRu)) {
      addError(`${owner} has empty descriptionRu`);
    }

    validateSourceRefs(owner, entity.sourceRefs);
  }
}

function validateAliasCollisions() {
  const aliasesByOwner = [
    ...items.map((item) => ({
      aliases: item.aliases,
      owner: `item:${item.slug}`,
    })),
    ...blessings.map((blessing) => ({
      aliases: blessing.aliases,
      owner: `blessing:${blessing.slug}`,
    })),
  ];
  const aliasOwners = new Map();

  for (const entity of aliasesByOwner) {
    if (!Array.isArray(entity.aliases)) {
      continue;
    }

    for (const alias of entity.aliases) {
      if (!isNonEmptyString(alias)) {
        continue;
      }

      const normalizedAlias = normalizeAlias(alias);

      if (!normalizedAlias) {
        continue;
      }

      if (!aliasOwners.has(normalizedAlias)) {
        aliasOwners.set(normalizedAlias, new Set());
      }

      aliasOwners.get(normalizedAlias).add(entity.owner);
    }
  }

  for (const [alias, owners] of aliasOwners.entries()) {
    if (owners.size <= 1) {
      continue;
    }

    if (isAllowedAliasCollision(alias, owners)) {
      continue;
    }

    addAliasWarning(`alias "${alias}" is used by ${Array.from(owners).sort().join(', ')}`);
  }
}

function validateSearchSmokeCases() {
  const smokeCases = [
    { query: 'хлеб', resultType: 'item', slug: 'bread' },
    { query: 'вода', resultType: 'item', slug: 'water' },
    { query: 'вино', resultType: 'item', slug: 'wine' },
    { query: 'печенье', resultType: 'item', slug: 'cookies' },
    { query: 'рис', resultType: 'item', slug: 'rice' },
    { query: 'манная каша', resultType: 'item', slug: 'semolina_porridge' },
    { query: 'хлею', resultType: 'item', slug: 'bread' },
    { query: 'маная каша', resultType: 'item', slug: 'semolina_porridge' },
    { query: 'виногрдный сок', resultType: 'item', slug: 'grape_juice' },
    { query: 'рахат лукум', resultType: 'item', slug: 'rahat_lukum' },
    { query: 'шеколь', resultType: 'blessing', slug: 'shehakol' },
    { query: 'шеакол', resultType: 'blessing', slug: 'shehakol' },
    { query: 'пицца', resultType: 'item', slug: 'pizza' },
    { query: 'абрикос', resultType: 'item', slug: 'apricot' },
    { query: 'ананас', resultType: 'item', slug: 'pineapple' },
    { query: 'мейн шалош', resultType: 'blessing', slug: 'mein_shalosh' },
    { query: 'радуга', resultType: 'blessing', slug: 'rainbow' },
    { query: 'рахат-лукум', resultType: 'item', slug: 'rahat_lukum' },
    { query: 'уксус', resultType: 'item', slug: 'vinegar' },
    { query: 'шакшука', resultType: 'item', slug: 'shakshuka' },
    { query: 'ячмень зерна', resultType: 'item', slug: 'barley_kernels' },
  ];

  for (const smokeCase of smokeCases) {
    const results = searchBlessings(smokeCase.query);
    const first = results[0];

    if (!first) {
      addError(`search "${smokeCase.query}" returned no results`);
      continue;
    }

    if (first.resultType !== smokeCase.resultType || first.slug !== smokeCase.slug) {
      addError(
        `search "${smokeCase.query}" expected first ${smokeCase.resultType}:${smokeCase.slug}, got ${first.resultType}:${first.slug}; top results: ${formatTopResults(results)}`,
      );
    }
  }
}

function expandBlessingItemTuple(tuple, index) {
  if (!Array.isArray(tuple)) {
    addError(`catalog.items[${index}] is not a tuple`);
    return null;
  }

  const [slug, titleRu, patternKey, aliases, options] = tuple;

  if (options !== undefined && !isPlainObject(options)) {
    addError(`catalog.items[${index}] options must be an object when provided`);
  }

  return {
    ...(isPlainObject(options) ? options : {}),
    aliases,
    patternKey,
    slug,
    titleRu,
    validationIndex: index,
  };
}

function validateAliases(owner, aliases) {
  if (!Array.isArray(aliases)) {
    addError(`${owner}.aliases must be an array`);
    return;
  }

  const seenAliases = new Map();

  aliases.forEach((alias, index) => {
    if (!isNonEmptyString(alias)) {
      addError(`${owner}.aliases[${index}] is empty`);
      return;
    }

    const normalizedAlias = normalizeExactAlias(alias);

    if (seenAliases.has(normalizedAlias)) {
      addError(
        `${owner}.aliases has duplicate alias "${alias}" (matches "${seenAliases.get(normalizedAlias)}")`,
      );
      return;
    }

    seenAliases.set(normalizedAlias, alias);
  });
}

function validateReferenceKeys(owner, propertyName, keys, knownKeys) {
  if (keys === undefined) {
    return;
  }

  if (!Array.isArray(keys)) {
    addError(`${owner}.${propertyName} must be an array when provided`);
    return;
  }

  keys.forEach((key, index) => {
    if (!isNonEmptyString(key)) {
      addError(`${owner}.${propertyName}[${index}] is empty`);
    } else if (!knownKeys.has(key)) {
      addError(`${owner}.${propertyName}[${index}] references missing key "${key}"`);
    }
  });
}

function validateSourceRefs(owner, sourceRefs) {
  if (sourceRefs === undefined) {
    return;
  }

  if (!Array.isArray(sourceRefs)) {
    addError(`${owner}.sourceRefs must be an array when provided`);
    return;
  }

  sourceRefs.forEach((sourceRef, index) => {
    if (!isNonEmptyString(sourceRef)) {
      addError(`${owner}.sourceRefs[${index}] is empty`);
    }
  });
}

function validateContentBlocks(owner, contentBlocks) {
  if (contentBlocks === undefined) {
    return;
  }

  if (!Array.isArray(contentBlocks)) {
    addError(`${owner}.contentBlocks must be an array when provided`);
    return;
  }

  contentBlocks.forEach((block, index) => {
    if (!isPlainObject(block)) {
      addError(`${owner}.contentBlocks[${index}] must be an object`);
      return;
    }

    validateOptionalBlessingSlug(`${owner}.contentBlocks[${index}]`, block.blessingSlug);
  });
}

function validateNusachVariants(owner, nusachVariants) {
  if (nusachVariants === undefined) {
    return;
  }

  if (!Array.isArray(nusachVariants)) {
    addError(`${owner}.nusachVariants must be an array when provided`);
    return;
  }

  nusachVariants.forEach((variant, index) => {
    if (!isPlainObject(variant)) {
      addError(`${owner}.nusachVariants[${index}] must be an object`);
      return;
    }

    const variantOwner = `${owner}.nusachVariants[${index}]`;

    if (!Array.isArray(variant.contentBlocks) || variant.contentBlocks.length === 0) {
      addError(`${variantOwner}.contentBlocks must be a non-empty array`);
      return;
    }

    validateContentBlocks(variantOwner, variant.contentBlocks);
  });
}

function validateOptionalBlessingSlug(owner, blessingSlug) {
  if (blessingSlug === undefined) {
    return;
  }

  if (!isNonEmptyString(blessingSlug)) {
    addError(`${owner}.blessingSlug is empty`);
  } else if (!blessingSlugs.has(blessingSlug)) {
    addError(`${owner}.blessingSlug references missing blessing "${blessingSlug}"`);
  }
}

function hasVariantStructure(blessing) {
  const directBlocks = Array.isArray(blessing.contentBlocks) ? blessing.contentBlocks : [];
  const variantBlocks = directBlocks.filter((block) => block?.kind === 'variant');

  if (variantBlocks.length > 0) {
    return true;
  }

  const nusachBlocks = Array.isArray(blessing.nusachVariants) ?
    blessing.nusachVariants.flatMap((variant) =>
      Array.isArray(variant.contentBlocks) ? variant.contentBlocks : [],
    ) :
    [];

  return nusachBlocks.some((block) => block?.kind === 'variant');
}

function validateUniqueProperty(collectionName, collection, propertyName, describe) {
  const seen = new Map();

  collection.forEach((entity, index) => {
    const value = entity?.[propertyName];
    const owner = describe(entity, index);

    if (!isNonEmptyString(value)) {
      addError(`${owner} is missing ${propertyName}`);
      return;
    }

    if (seen.has(value)) {
      addError(
        `${collectionName} has duplicate ${propertyName} "${value}" on ${seen.get(value)} and ${owner}`,
      );
      return;
    }

    seen.set(value, owner);
  });
}

function keySet(collection, propertyName) {
  return new Set(
    collection
      .map((entity) => entity?.[propertyName])
      .filter((value) => isNonEmptyString(value)),
  );
}

function ensureArray(label, value) {
  if (!Array.isArray(value)) {
    addError(`${label} must be an array`);
    return [];
  }

  return value;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasKeys(value) {
  return Array.isArray(value) && value.length > 0;
}

function normalizeAlias(alias) {
  return normalizeBlessingQuery(alias);
}

function normalizeExactAlias(alias) {
  return alias.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isAllowedAliasCollision(alias, owners) {
  return allowedAliasCollisions.get(alias) === formatAliasOwnersKey(owners);
}

function formatAliasOwnersKey(owners) {
  return Array.from(owners).sort().join('|');
}

function formatTopResults(results) {
  return results
    .slice(0, 5)
    .map((result) => `${result.resultType}:${result.slug}`)
    .join(', ');
}

function describeBlessing(blessing, index) {
  return `blessing:${describeKey(blessing?.slug, index)}`;
}

function describePattern(pattern, index) {
  return `pattern:${describeKey(pattern?.key, index)}`;
}

function describeCondition(condition, index) {
  return `condition:${describeKey(condition?.key, index)}`;
}

function describeNote(note, index) {
  return `note:${describeKey(note?.key, index)}`;
}

function describeDispute(dispute, index) {
  return `dispute:${describeKey(dispute?.key, index)}`;
}

function describeItem(item, index) {
  return `item:${describeKey(item?.slug, item?.validationIndex ?? index)}`;
}

function describeKey(value, index) {
  return isNonEmptyString(value) ? value : `[${index}]`;
}

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function addAliasWarning(message) {
  aliasWarnings.push(message);
  warnings.push(message);
}

function printList(title, itemsToPrint, printer) {
  printer(`${title} (${itemsToPrint.length}):`);

  for (const item of itemsToPrint) {
    printer(`- ${item}`);
  }
}

function printCounts() {
  console.log('counts:');
  console.log(`- blessings: ${blessings.length}`);
  console.log(`- patterns: ${patterns.length}`);
  console.log(`- conditions: ${conditions.length}`);
  console.log(`- notes: ${notes.length}`);
  console.log(`- disputes: ${disputes.length}`);
  console.log(`- items: ${items.length}`);
  console.log(`- alias warnings: ${aliasWarnings.length}`);
}
