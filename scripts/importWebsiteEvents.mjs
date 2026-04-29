#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';
import { resolve } from 'node:path';

import { load } from 'cheerio';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;

const DEFAULT_SOURCE_URL = 'https://www.sredisvoih.com/events/';
const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const IMPORT_SOURCE_NAME = 'Сайт Среди Своих — события';
const IMPORT_SOURCE_TYPE = 'website';
const PARSER_NAME = 'sredi_svoih_events';
const EVENT_SOURCE_TYPE = 'website_scrape';
const TIMEZONE = 'Europe/Moscow';
const DEFAULT_LOCATION_NAME = 'Среди Своих';
const DEFAULT_ADDRESS = 'Москва, ул. Льва Толстого, 14';
const DEFAULT_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'ru-RU,ru;q=0.9,en;q=0.7',
  'user-agent': 'sredi-svoih-local-events-importer/1.0 (+https://github.com/timafor-code/sredi-svoih-app)',
};

const monthNumbers = new Map([
  ['января', 1],
  ['январь', 1],
  ['февраля', 2],
  ['февраль', 2],
  ['марта', 3],
  ['март', 3],
  ['апреля', 4],
  ['апрель', 4],
  ['мая', 5],
  ['май', 5],
  ['июня', 6],
  ['июнь', 6],
  ['июля', 7],
  ['июль', 7],
  ['августа', 8],
  ['август', 8],
  ['сентября', 9],
  ['сентябрь', 9],
  ['октября', 10],
  ['октябрь', 10],
  ['ноября', 11],
  ['ноябрь', 11],
  ['декабря', 12],
  ['декабрь', 12],
]);

const monthPattern = [...monthNumbers.keys()].join('|');

function loadLocalEnv() {
  loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
}

function printUsage() {
  console.log(`
Usage:
  node ./scripts/importWebsiteEvents.mjs [--dry-run|--apply] [--limit N] [--source-url URL] [--verbose]

Defaults:
  --dry-run
  --source-url ${DEFAULT_SOURCE_URL}
  DATABASE_URL=${DEFAULT_DATABASE_URL}
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: false,
    limit: null,
    sourceUrl: DEFAULT_SOURCE_URL,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }

    if (arg === '--limit') {
      const rawLimit = argv[index + 1];
      index += 1;
      options.limit = parseLimit(rawLimit);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parseLimit(arg.slice('--limit='.length));
      continue;
    }

    if (arg === '--source-url') {
      const rawUrl = argv[index + 1];
      index += 1;
      options.sourceUrl = parseSourceUrl(rawUrl);
      continue;
    }

    if (arg.startsWith('--source-url=')) {
      options.sourceUrl = parseSourceUrl(arg.slice('--source-url='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.apply && !options.dryRun) {
    options.dryRun = true;
  }

  if (options.apply && options.dryRun) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }

  options.sourceUrl = canonicalUrl(options.sourceUrl);

  return options;
}

function parseLimit(value) {
  const limit = Number.parseInt(value, 10);

  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`--limit must be a positive integer, got: ${value}`);
  }

  return limit;
}

function parseSourceUrl(value) {
  if (!value) {
    throw new Error('--source-url requires a URL value.');
  }

  return value;
}

function canonicalUrl(value) {
  return new URL(value).href;
}

function cleanText(value) {
  return (value ?? '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactText(value) {
  return cleanText(value).replace(/\s+/g, ' ').trim();
}

function textWithBreaks($, selection) {
  const clone = selection.clone();
  clone.find('script, style, svg').remove();
  clone.find('br').replaceWith('\n');
  return cleanText(clone.text());
}

function shortText(value, maxLength = 240) {
  const text = compactText(value);

  if (!text) {
    return null;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function absoluteUrl(value, baseUrl) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function sameHost(url, sourceUrl) {
  try {
    return new URL(url).host === new URL(sourceUrl).host;
  } catch {
    return false;
  }
}

function sourceExternalIdFromUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const slug = parts.at(-1);

  if (slug && slug !== 'events') {
    return slug.toLowerCase();
  }

  return createHash('sha256').update(url.href).digest('hex').slice(0, 16);
}

function normalizeTitle(title) {
  return compactText(title)
    .replace(/\s+[|—-]\s+Среди\s+Своих$/i, '')
    .replace(/\s+[|—-]\s+Еврейская\s+община.*$/i, '')
    .trim();
}

async function fetchHtml(url, verbose) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    if (verbose) {
      console.log(`[fetch] ${url}`);
    }

    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseListPage(html, sourceUrl) {
  const $ = load(html);
  const cards = [];

  $('.events__event').each((_, element) => {
    const card = $(element);
    const detailHref = card.find('a.events__event__link').first().attr('href')
      ?? card.find('a[href*="/events/"]').first().attr('href');
    const detailUrl = absoluteUrl(detailHref, sourceUrl);

    if (!detailUrl || new URL(detailUrl).pathname.replace(/\/+$/, '') === '/events') {
      return;
    }

    const imageSrc = card.find('img').first().attr('src') ?? null;
    const title = normalizeTitle(
      card.find('h5').first().text()
        || card.find('img').first().attr('alt')
        || card.find('a').first().text(),
    );
    const hidden = card.find('.events__event__hidden').first().clone();
    hidden.find('h5, a, svg').remove();
    const rawShortText = textWithBreaks($, hidden);
    const rawCategory = compactText(card.attr('data-tab-content') ?? '')
      .split(/\s+/)
      .filter((item) => item && item.toLowerCase() !== 'all')
      .join(' ') || null;
    const timeText = compactText(card.find('.time').first().text());

    cards.push({
      detailUrl,
      externalId: sourceExternalIdFromUrl(detailUrl),
      title,
      imageUrl: absoluteUrl(imageSrc, sourceUrl),
      shortDescription: shortText(rawShortText),
      rawCategory,
      rawTimeText: timeText || null,
      rawCardPayload: {
        element_id: card.attr('id') ?? null,
        data_tab_content: card.attr('data-tab-content') ?? null,
        detail_href: detailHref ?? null,
        detail_url: detailUrl,
        image_src: imageSrc,
        image_url: absoluteUrl(imageSrc, sourceUrl),
        title,
        time_text: timeText || null,
        short_text: rawShortText || null,
        html: $.html(card),
      },
    });
  });

  if (cards.length === 0) {
    $('a[href*="/events/"]').each((_, element) => {
      const detailUrl = absoluteUrl($(element).attr('href'), sourceUrl);

      if (!detailUrl) {
        return;
      }

      const path = new URL(detailUrl).pathname.replace(/\/+$/, '');
      if (path === '/events') {
        return;
      }

      cards.push({
        detailUrl,
        externalId: sourceExternalIdFromUrl(detailUrl),
        title: normalizeTitle($(element).text()),
        imageUrl: null,
        shortDescription: null,
        rawCategory: null,
        rawTimeText: null,
        rawCardPayload: {
          detail_url: detailUrl,
          link_text: compactText($(element).text()),
          html: $.html(element),
        },
      });
    });
  }

  const seen = new Set();
  return cards.filter((card) => {
    const key = card.externalId || card.detailUrl;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractRelevantDateText(description, dateBlock, listTimeText) {
  const candidates = [];
  const text = compactText(description);

  if (dateBlock) {
    candidates.push(dateBlock);
  }

  if (listTimeText) {
    candidates.push(listTimeText);
  }

  const labelRegex = /(?:когда|дата|дата и время|начало(?: занятий)?|расписание|время)\s*:\s*([^.;]+(?:[.;]|$))/giu;
  for (const match of text.matchAll(labelRegex)) {
    candidates.push(match[0]);
  }

  const monthRegex = new RegExp(`.{0,36}\\b\\d{1,2}\\s+(?:${monthPattern})\\b.{0,56}`, 'giu');
  for (const match of text.matchAll(monthRegex)) {
    candidates.push(match[0]);
  }

  const numericDateRegex = /.{0,36}\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.{0,56}/gu;
  for (const match of text.matchAll(numericDateRegex)) {
    candidates.push(match[0]);
  }

  return candidates.map(compactText).filter(Boolean).join(' | ');
}

function findTimeNear(text, index) {
  const windowText = text.slice(index, index + 100);
  const timeMatch = windowText.match(/(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)/u);

  if (!timeMatch) {
    return null;
  }

  return {
    hour: Number.parseInt(timeMatch[1], 10),
    minute: Number.parseInt(timeMatch[2], 10),
  };
}

function buildMoscowIso(year, month, day, hour, minute) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`;
}

function parseConfidentStartsAt(rawDateText) {
  const text = compactText(rawDateText);

  if (!text) {
    return {
      startsAt: null,
      rawDateText: null,
      warning: 'No date text found on the card or detail page.',
    };
  }

  const ruDateRegex = new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\s*(?:г\\.?|года)?)?`, 'iu');
  const ruDateMatch = ruDateRegex.exec(text);

  if (ruDateMatch?.index !== undefined) {
    const time = findTimeNear(text, ruDateMatch.index);

    if (!time) {
      return {
        startsAt: null,
        rawDateText: text,
        warning: 'Full date has a year, but no reliable time was found.',
      };
    }

    const startsAt = buildMoscowIso(
      Number.parseInt(ruDateMatch[3], 10),
      monthNumbers.get(ruDateMatch[2].toLowerCase()),
      Number.parseInt(ruDateMatch[1], 10),
      time.hour,
      time.minute,
    );

    return startsAt
      ? { startsAt, rawDateText: text, warning: null }
      : { startsAt: null, rawDateText: text, warning: 'Parsed date is invalid.' };
  }

  const numericDateRegex = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/u;
  const numericDateMatch = numericDateRegex.exec(text);

  if (numericDateMatch?.index !== undefined) {
    const time = findTimeNear(text, numericDateMatch.index);

    if (!time) {
      return {
        startsAt: null,
        rawDateText: text,
        warning: 'Numeric date has a year, but no reliable time was found.',
      };
    }

    const startsAt = buildMoscowIso(
      Number.parseInt(numericDateMatch[3], 10),
      Number.parseInt(numericDateMatch[2], 10),
      Number.parseInt(numericDateMatch[1], 10),
      time.hour,
      time.minute,
    );

    return startsAt
      ? { startsAt, rawDateText: text, warning: null }
      : { startsAt: null, rawDateText: text, warning: 'Parsed numeric date is invalid.' };
  }

  const partialRuDateRegex = new RegExp(`\\b\\d{1,2}\\s+(?:${monthPattern})\\b`, 'iu');
  const hasPartialDate = partialRuDateRegex.test(text);
  const hasTime = /(?:^|\D)([01]?\d|2[0-3])[:.]\d{2}(?:\D|$)/u.test(text);

  return {
    startsAt: null,
    rawDateText: text,
    warning: hasPartialDate || hasTime
      ? 'Only partial or recurring date/time text was found.'
      : 'No full date with year and time was found.',
  };
}

function extractLabeledValue(text, labels) {
  const compact = compactText(text);

  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*:\\s*([^.;]+)`, 'iu');
    const match = regex.exec(compact);

    if (match?.[1]) {
      return compactText(match[1]);
    }
  }

  return null;
}

function normalizeAddress(value) {
  const address = compactText(value);

  if (!address) {
    return DEFAULT_ADDRESS;
  }

  if (/льва\s+толстого,\s*14/iu.test(address)) {
    return DEFAULT_ADDRESS;
  }

  if (/москва/iu.test(address)) {
    return address;
  }

  return `Москва, ${address}`;
}

function inferLocation(description) {
  const parsed = extractLabeledValue(description, ['Место', 'Где', 'Адрес']);

  if (!parsed) {
    return {
      locationName: DEFAULT_LOCATION_NAME,
      address: DEFAULT_ADDRESS,
      parsedLocation: null,
    };
  }

  return {
    locationName: DEFAULT_LOCATION_NAME,
    address: normalizeAddress(parsed),
    parsedLocation: parsed,
  };
}

function inferCategory(title, rawCategory) {
  const text = `${title ?? ''} ${rawCategory ?? ''}`.toLocaleLowerCase('ru-RU');

  if (/шабб?ат/u.test(text)) {
    return 'shabbat';
  }

  if (/детск|воскресн(?:ая|ой)\s+школ/u.test(text)) {
    return 'children';
  }

  if (/песах|ханук|пурим|шавуот|суккот|симхат|рош\s+а?шана|йом\s+кипур|праздник/u.test(text)) {
    return 'holiday';
  }

  if (/лекци/u.test(text)) {
    return 'lecture';
  }

  if (/курс|изучени|иудаизм|истори|тора|философ/u.test(text)) {
    return 'class';
  }

  return 'community';
}

function inferAudience(category, title) {
  const text = (title ?? '').toLocaleLowerCase('ru-RU');

  if (category === 'children' || /детск|воскресн(?:ая|ой)\s+школ/u.test(text)) {
    return 'children';
  }

  return 'all';
}

function findRegistrationUrl($, sourceUrl, detailUrl) {
  const candidates = [];

  $('.event-page__head a, main a').each((_, element) => {
    const link = $(element);
    const href = link.attr('href');
    const text = compactText(link.text()).toLocaleLowerCase('ru-RU');
    const absolute = absoluteUrl(href, detailUrl);

    if (!href || !absolute) {
      return;
    }

    const isRegistrationText = /запис|регистрац/u.test(text);
    const isExternal = /^https?:\/\//iu.test(href) && !sameHost(absolute, sourceUrl);
    const isTimepad = /timepad\.ru/iu.test(absolute);

    if ((isRegistrationText || isTimepad) && (isExternal || isTimepad)) {
      candidates.push(absolute);
    }
  });

  return candidates[0] ?? null;
}

function parseDetailPage(html, card, sourceUrl) {
  const $ = load(html);
  const title = normalizeTitle(
    $('h1').first().text()
      || $('meta[property="og:title"]').attr('content')
      || $('title').first().text()
      || card.title,
  );
  const head = $('.event-page__head').first();
  const detailDescription = textWithBreaks($, head.find('h4').first());
  const description = detailDescription || card.shortDescription || null;
  const imageUrl = absoluteUrl(
    head.find('img').first().attr('src')
      ?? $('meta[property="og:image"]').attr('content')
      ?? card.imageUrl,
    sourceUrl,
  );
  const dateBlock = compactText(head.find('.event-page__head__date').first().text());
  const rawDateText = extractRelevantDateText(description, dateBlock, card.rawTimeText);
  const parsedDate = parseConfidentStartsAt(rawDateText);
  const category = inferCategory(title, card.rawCategory);
  const audience = inferAudience(category, title);
  const location = inferLocation(description);
  const registrationUrl = findRegistrationUrl($, sourceUrl, card.detailUrl);

  return {
    externalId: card.externalId,
    sourceUrl: card.detailUrl,
    title,
    imageUrl,
    description,
    shortDescription: shortText(description ?? card.shortDescription ?? title),
    startsAt: parsedDate.startsAt,
    rawDateText: parsedDate.rawDateText,
    dateWarning: parsedDate.warning,
    locationName: location.locationName,
    address: location.address,
    parsedLocation: location.parsedLocation,
    registrationMode: registrationUrl ? 'external_link' : 'none',
    registrationUrl,
    category,
    audience,
    visibility: 'public',
    status: parsedDate.startsAt ? 'published' : 'ignored',
    rawCategory: card.rawCategory,
    rawPayload: {
      parser_name: PARSER_NAME,
      card: card.rawCardPayload,
      detail: {
        source_url: card.detailUrl,
        title,
        image_url: imageUrl,
        date_text: dateBlock || null,
        description,
        registration_url: registrationUrl,
        html,
      },
      parsed: {
        external_id: card.externalId,
        title,
        starts_at: parsedDate.startsAt,
        raw_date_text: parsedDate.rawDateText,
        date_warning: parsedDate.warning,
        location_name: location.locationName,
        address: location.address,
        parsed_location: location.parsedLocation,
        category,
        audience,
        registration_mode: registrationUrl ? 'external_link' : 'none',
        registration_url: registrationUrl,
      },
    },
  };
}

async function parseWebsiteEvents(options) {
  const listHtml = await fetchHtml(options.sourceUrl, options.verbose);
  const cards = parseListPage(listHtml, options.sourceUrl);
  const limitedCards = options.limit ? cards.slice(0, options.limit) : cards;
  const parsedItems = [];

  for (const card of limitedCards) {
    try {
      const detailHtml = await fetchHtml(card.detailUrl, options.verbose);
      parsedItems.push({
        item: parseDetailPage(detailHtml, card, options.sourceUrl),
        error: null,
      });
    } catch (error) {
      parsedItems.push({
        item: {
          externalId: card.externalId,
          sourceUrl: card.detailUrl,
          title: card.title || card.detailUrl,
          startsAt: null,
          parsedLocation: null,
          rawPayload: {
            parser_name: PARSER_NAME,
            card: card.rawCardPayload,
            parse_error: error instanceof Error ? error.message : String(error),
          },
        },
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return {
    foundOnList: cards.length,
    items: parsedItems,
  };
}

function printDryRunSummary(result) {
  const confident = result.items.filter(({ item }) => Boolean(item.startsAt)).length;
  const errors = result.items.filter(({ error }) => Boolean(error)).length;
  const ignored = result.items.length - confident - errors;

  console.log(`Found cards on list: ${result.foundOnList}`);
  console.log(`Fetched detail pages: ${result.items.length}`);
  console.log('');

  result.items.forEach(({ item, error }, index) => {
    console.log(`${index + 1}. ${item.title}`);
    console.log(`   source_url: ${item.sourceUrl}`);
    console.log(`   external_id: ${item.externalId}`);

    if (error) {
      console.log('   status: error');
      console.log(`   error: ${error.message}`);
      return;
    }

    console.log(`   category/audience: ${item.category}/${item.audience}`);
    console.log(`   image_url: ${item.imageUrl ?? '(none)'}`);
    console.log(`   registration: ${item.registrationMode}${item.registrationUrl ? ` (${item.registrationUrl})` : ''}`);
    console.log(`   raw_date_text: ${item.rawDateText ?? '(none)'}`);

    if (item.startsAt) {
      console.log(`   starts_at: ${item.startsAt}`);
    } else {
      console.log(`   warning: ${item.dateWarning}`);
    }
  });

  console.log('');
  console.log(`Dry-run summary: confident=${confident}, ignored=${ignored}, errors=${errors}`);
}

async function connectDatabase() {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function getCommunityId(client) {
  const result = await client.query(
    `
      select id
      from public.communities
      where slug = 'sredi-svoih'
         or name = 'Среди Своих'
      order by case when slug = 'sredi-svoih' then 0 else 1 end, created_at
      limit 1
    `,
  );

  const communityId = result.rows[0]?.id;

  if (!communityId) {
    throw new Error('Community "Среди Своих" was not found in public.communities.');
  }

  return communityId;
}

async function ensureImportSource(client, sourceUrl, communityId) {
  const existing = await client.query(
    `
      select id
      from public.event_import_sources
      where parser_name = $1
        and url = $2
      order by created_at
      limit 1
    `,
    [PARSER_NAME, sourceUrl],
  );

  if (existing.rows[0]?.id) {
    const updated = await client.query(
      `
        update public.event_import_sources
        set
          community_id = $2,
          name = $3,
          source_type = $4,
          url = $5,
          parser_name = $6,
          is_active = true
        where id = $1
        returning *
      `,
      [
        existing.rows[0].id,
        communityId,
        IMPORT_SOURCE_NAME,
        IMPORT_SOURCE_TYPE,
        sourceUrl,
        PARSER_NAME,
      ],
    );

    return updated.rows[0];
  }

  const inserted = await client.query(
    `
      insert into public.event_import_sources (
        community_id,
        name,
        source_type,
        url,
        parser_name,
        is_active
      )
      values ($1, $2, $3, $4, $5, true)
      returning *
    `,
    [communityId, IMPORT_SOURCE_NAME, IMPORT_SOURCE_TYPE, sourceUrl, PARSER_NAME],
  );

  return inserted.rows[0];
}

async function createImportRun(client, sourceId) {
  const result = await client.query(
    `
      insert into public.event_import_runs (source_id, status, started_at)
      values ($1, 'started', now())
      returning *
    `,
    [sourceId],
  );

  return result.rows[0];
}

async function finishImportRun(client, runId, summary, status = 'success', error = null) {
  await client.query(
    `
      update public.event_import_runs
      set
        status = $2,
        finished_at = now(),
        found_count = $3,
        created_count = $4,
        updated_count = $5,
        error = $6
      where id = $1
    `,
    [
      runId,
      status,
      summary.foundCount,
      summary.createdCount,
      summary.updatedCount,
      error,
    ],
  );
}

async function insertImportItem(client, sourceId, runId, item, status, linkedEventId, rawPayload) {
  await client.query(
    `
      insert into public.event_import_items (
        source_id,
        run_id,
        external_id,
        source_url,
        raw_payload,
        parsed_title,
        parsed_starts_at,
        parsed_location,
        linked_event_id,
        status
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
    `,
    [
      sourceId,
      runId,
      item.externalId ?? null,
      item.sourceUrl ?? null,
      JSON.stringify(rawPayload),
      item.title ?? null,
      item.startsAt ?? null,
      item.parsedLocation ?? null,
      linkedEventId,
      status,
    ],
  );
}

function buildEventValues(item, communityId) {
  return {
    communityId,
    title: item.title,
    subtitle: null,
    shortDescription: item.shortDescription,
    description: item.description,
    startsAt: item.startsAt,
    endsAt: null,
    timezone: TIMEZONE,
    locationName: item.locationName || DEFAULT_LOCATION_NAME,
    address: item.address || DEFAULT_ADDRESS,
    imageUrl: item.imageUrl,
    category: item.category,
    audience: item.audience,
    visibility: 'public',
    status: 'published',
    sourceType: EVENT_SOURCE_TYPE,
    sourceUrl: item.sourceUrl,
    sourceExternalId: item.externalId,
    registrationMode: item.registrationMode,
    registrationUrl: item.registrationUrl,
    capacity: null,
    waitlistEnabled: false,
    requiresApproval: false,
    priceAmount: null,
    priceCurrency: null,
  };
}

async function createEvent(client, values) {
  const result = await client.query(
    `
      insert into public.events (
        community_id,
        title,
        subtitle,
        short_description,
        description,
        starts_at,
        ends_at,
        timezone,
        location_name,
        address,
        image_url,
        category,
        audience,
        visibility,
        status,
        source_type,
        source_url,
        source_external_id,
        manual_override,
        registration_mode,
        registration_url,
        capacity,
        waitlist_enabled,
        requires_approval,
        price_amount,
        price_currency,
        published_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, false, $19,
        $20, $21, $22, $23, $24, $25, now()
      )
      returning id
    `,
    [
      values.communityId,
      values.title,
      values.subtitle,
      values.shortDescription,
      values.description,
      values.startsAt,
      values.endsAt,
      values.timezone,
      values.locationName,
      values.address,
      values.imageUrl,
      values.category,
      values.audience,
      values.visibility,
      values.status,
      values.sourceType,
      values.sourceUrl,
      values.sourceExternalId,
      values.registrationMode,
      values.registrationUrl,
      values.capacity,
      values.waitlistEnabled,
      values.requiresApproval,
      values.priceAmount,
      values.priceCurrency,
    ],
  );

  return result.rows[0].id;
}

async function updateEvent(client, eventId, values) {
  const result = await client.query(
    `
      update public.events
      set
        title = $2,
        subtitle = $3,
        short_description = $4,
        description = $5,
        starts_at = $6,
        ends_at = $7,
        timezone = $8,
        location_name = $9,
        address = $10,
        image_url = $11,
        category = $12,
        audience = $13,
        visibility = $14,
        status = $15,
        source_url = $16,
        registration_mode = $17,
        registration_url = $18,
        capacity = $19,
        waitlist_enabled = $20,
        requires_approval = $21,
        price_amount = $22,
        price_currency = $23,
        published_at = coalesce(public.events.published_at, now())
      where id = $1
        and manual_override = false
      returning id
    `,
    [
      eventId,
      values.title,
      values.subtitle,
      values.shortDescription,
      values.description,
      values.startsAt,
      values.endsAt,
      values.timezone,
      values.locationName,
      values.address,
      values.imageUrl,
      values.category,
      values.audience,
      values.visibility,
      values.status,
      values.sourceUrl,
      values.registrationMode,
      values.registrationUrl,
      values.capacity,
      values.waitlistEnabled,
      values.requiresApproval,
      values.priceAmount,
      values.priceCurrency,
    ],
  );

  return result.rows[0]?.id ?? null;
}

async function createOrUpdateEvent(client, item, communityId) {
  const existing = await client.query(
    `
      select id, manual_override
      from public.events
      where source_type = $1
        and source_external_id = $2
      order by created_at
      limit 1
    `,
    [EVENT_SOURCE_TYPE, item.externalId],
  );
  const existingEvent = existing.rows[0] ?? null;

  if (existingEvent?.manual_override) {
    return {
      action: 'manual_override',
      eventId: existingEvent.id,
    };
  }

  const values = buildEventValues(item, communityId);

  if (existingEvent) {
    const eventId = await updateEvent(client, existingEvent.id, values);

    return {
      action: eventId ? 'updated' : 'manual_override',
      eventId: eventId ?? existingEvent.id,
    };
  }

  const eventId = await createEvent(client, values);

  return {
    action: 'created',
    eventId,
  };
}

async function applyImport(options) {
  const client = await connectDatabase();
  let run = null;
  const summary = {
    foundCount: 0,
    createdCount: 0,
    updatedCount: 0,
    ignoredCount: 0,
    errorCount: 0,
    manualOverrideCount: 0,
  };

  try {
    const communityId = await getCommunityId(client);
    const source = await ensureImportSource(client, options.sourceUrl, communityId);
    run = await createImportRun(client, source.id);
    const result = await parseWebsiteEvents(options);
    summary.foundCount = result.items.length;

    for (const { item, error } of result.items) {
      if (error) {
        summary.errorCount += 1;
        await insertImportItem(client, source.id, run.id, item, 'error', null, {
          ...item.rawPayload,
          import_status: 'error',
          import_error: error.message,
        });
        console.warn(`[error] ${item.sourceUrl}: ${error.message}`);
        continue;
      }

      if (!item.startsAt) {
        summary.ignoredCount += 1;
        await insertImportItem(client, source.id, run.id, item, 'ignored', null, {
          ...item.rawPayload,
          import_status: 'ignored',
          import_status_reason: item.dateWarning,
        });
        console.warn(`[ignored] ${item.title}: ${item.dateWarning}`);
        continue;
      }

      const eventResult = await createOrUpdateEvent(client, item, communityId);

      if (eventResult.action === 'created') {
        summary.createdCount += 1;
      } else if (eventResult.action === 'updated') {
        summary.updatedCount += 1;
      } else {
        summary.ignoredCount += 1;
        summary.manualOverrideCount += 1;
      }

      await insertImportItem(
        client,
        source.id,
        run.id,
        item,
        eventResult.action === 'manual_override' ? 'ignored' : 'linked',
        eventResult.eventId,
        {
          ...item.rawPayload,
          import_status: eventResult.action === 'manual_override' ? 'ignored' : 'linked',
          import_status_reason: eventResult.action === 'manual_override'
            ? 'Existing event has manual_override = true.'
            : null,
          linked_event_id: eventResult.eventId,
          event_action: eventResult.action,
        },
      );
    }

    const runError = summary.errorCount > 0
      ? `Completed with ${summary.errorCount} item error(s).`
      : null;

    await finishImportRun(client, run.id, summary, 'success', runError);
    await client.query(
      'update public.event_import_sources set last_run_at = now() where id = $1',
      [source.id],
    );

    return { ...summary, runId: run.id, sourceId: source.id };
  } catch (error) {
    if (run?.id) {
      await finishImportRun(
        client,
        run.id,
        summary,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    }

    throw error;
  } finally {
    await client.end();
  }
}

function printApplySummary(summary) {
  console.log('');
  console.log(`Apply summary: run_id=${summary.runId}`);
  console.log(`found=${summary.foundCount}, created=${summary.createdCount}, updated=${summary.updatedCount}, ignored=${summary.ignoredCount}, item_errors=${summary.errorCount}, manual_override=${summary.manualOverrideCount}`);
}

async function main() {
  loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run'}`);
  console.log(`Source URL: ${options.sourceUrl}`);
  if (options.limit) {
    console.log(`Limit: ${options.limit}`);
  }
  console.log('');

  if (options.dryRun) {
    const result = await parseWebsiteEvents(options);
    printDryRunSummary(result);
    return;
  }

  const summary = await applyImport(options);
  printApplySummary(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
