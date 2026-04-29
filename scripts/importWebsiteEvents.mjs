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
const PARSER_VERSION = '1.1.0';
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

// ============================================================
// CLI
// ============================================================

function loadLocalEnv() {
  loadEnv({ path: resolve(process.cwd(), '.env.local'), quiet: true });
  loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
}

function printUsage() {
  console.log(`
Usage:
  node ./scripts/importWebsiteEvents.mjs [--dry-run|--apply] [--limit N] [--source-url URL] [--verbose]
  node ./scripts/importWebsiteEvents.mjs --review [--limit N]

Modes:
  --dry-run           Fetch and parse events, print summary without writing to DB (default)
  --apply             Write import run/items to DB, create/update events
  --review            Query DB and show items needing review

Options:
  --limit N              Process at most N cards (or show N review items)
  --source-url URL       Override default events page URL
  --verbose              Print fetched URLs
  --create-drafts        (with --apply) Create draft/hidden events for partial dates that have a suggestedStartsAt
  --assume-year YYYY     Provide assumed year for partial dates (day+month only, no year)

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
    review: false,
    limit: null,
    sourceUrl: DEFAULT_SOURCE_URL,
    verbose: false,
    createDrafts: false,
    assumeYear: null,
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

    if (arg === '--review') {
      options.review = true;
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }

    if (arg === '--create-drafts') {
      options.createDrafts = true;
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

    if (arg === '--assume-year') {
      const rawYear = argv[index + 1];
      index += 1;
      options.assumeYear = parseYear(rawYear);
      continue;
    }

    if (arg.startsWith('--assume-year=')) {
      options.assumeYear = parseYear(arg.slice('--assume-year='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.review) {
    if (options.apply || options.dryRun) {
      throw new Error('--review cannot be combined with --apply or --dry-run.');
    }
    return options;
  }

  if (!options.apply && !options.dryRun) {
    options.dryRun = true;
  }

  if (options.apply && options.dryRun) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }

  if (options.createDrafts && !options.apply) {
    throw new Error('--create-drafts requires --apply.');
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

function parseYear(value) {
  const year = Number.parseInt(value, 10);

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    throw new Error(`--assume-year must be a 4-digit year between 2000 and 2100, got: ${value}`);
  }

  return year;
}

function canonicalUrl(value) {
  return new URL(value).href;
}

// ============================================================
// Text utilities
// ============================================================

function cleanText(value) {
  return (value ?? '')
    .replace(/\r/g, '\n')
    .replace(/ /g, ' ')
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

// ============================================================
// URL utilities
// ============================================================

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

// ============================================================
// Fetch
// ============================================================

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

// ============================================================
// List page parser
// ============================================================

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

// ============================================================
// Date utilities
// ============================================================

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

// ============================================================
// Date confidence classification
// ============================================================

function extractDateSignals(rawDateText, rawTimeText) {
  const text = compactText(rawDateText ?? '');
  const timeText = compactText(rawTimeText ?? '');
  const allText = [text, timeText].filter(Boolean).join(' ');

  const signals = {
    hasFullDate: false,
    hasPartialDate: false,
    hasTime: false,
    hasRecurringDayOfWeek: false,
    year: null,
    month: null,
    day: null,
    hour: null,
    minute: null,
  };

  // Full Russian date: "13 ноября 2026"
  const ruFullRegex = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\s*(?:г\\.?|года)?)?`,
    'iu',
  );
  const ruFullMatch = ruFullRegex.exec(text);

  if (ruFullMatch) {
    signals.hasFullDate = true;
    signals.day = Number.parseInt(ruFullMatch[1], 10);
    signals.month = monthNumbers.get(ruFullMatch[2].toLowerCase());
    signals.year = Number.parseInt(ruFullMatch[3], 10);
  }

  // Numeric full date: "13.11.2026"
  if (!signals.hasFullDate) {
    const numRegex = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/u;
    const numMatch = numRegex.exec(text);

    if (numMatch) {
      signals.hasFullDate = true;
      signals.day = Number.parseInt(numMatch[1], 10);
      signals.month = Number.parseInt(numMatch[2], 10);
      signals.year = Number.parseInt(numMatch[3], 10);
    }
  }

  // Partial Russian date: "13 ноября" (day + month, no year)
  // Note: no trailing \b because \b doesn't work with Cyrillic in JS regex (\w is ASCII-only)
  if (!signals.hasFullDate) {
    const ruPartialRegex = new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})`, 'iu');
    const partialMatch = ruPartialRegex.exec(text);

    if (partialMatch) {
      signals.hasPartialDate = true;
      signals.day = Number.parseInt(partialMatch[1], 10);
      signals.month = monthNumbers.get(partialMatch[2].toLowerCase());
    }
  }

  // Time: "19:30" or "19.30" anywhere in combined text
  const timeRegex = /(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)/u;
  const timeMatch = timeRegex.exec(allText);

  if (timeMatch) {
    signals.hasTime = true;
    signals.hour = Number.parseInt(timeMatch[1], 10);
    signals.minute = Number.parseInt(timeMatch[2], 10);
  }

  // Recurring day of week: "по четвергам", "по понедельникам", etc.
  // Use [\s:,] lookahead instead of \b — Cyrillic is not \w, so \b fails on Cyrillic boundaries
  const recurringDativRegex = /(?:^|[\s:,])по\s+(?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)/iu;
  const recurringEveryRegex = /кажд(?:ый|ое|ую)\s+(?:воскресенье|понедельник|вторник|среду|четверг|пятницу|субботу)/iu;

  if (recurringDativRegex.test(allText) || recurringEveryRegex.test(allText)) {
    signals.hasRecurringDayOfWeek = true;
  }

  // Shabbat — always a weekly recurring event; no \b needed
  if (/шабб?ат/iu.test(allText)) {
    signals.hasRecurringDayOfWeek = true;
  }

  return signals;
}

function classifyDateConfidence(signals) {
  if (signals.hasFullDate && signals.hasTime) {
    return 'confident';
  }

  if (signals.hasFullDate) {
    // Full date (day+month+year) but no time — can't build reliable starts_at
    return 'partial';
  }

  if (signals.hasPartialDate) {
    // Day+month found but no year
    return 'partial';
  }

  if (signals.hasRecurringDayOfWeek) {
    return 'recurring_rule';
  }

  return 'none';
}

function buildImportReview(signals, dateConfidence, parsedDate, options) {
  let suggestedStartsAt = null;
  let assumedYear = null;
  let dateStatus = 'needs_review';
  let reason;

  if (dateConfidence === 'confident') {
    dateStatus = 'ready';
    reason = 'Full date with year and time found.';
  } else if (dateConfidence === 'partial') {
    if (signals.hasPartialDate && options.assumeYear) {
      assumedYear = options.assumeYear;

      if (signals.hasTime) {
        suggestedStartsAt = buildMoscowIso(
          options.assumeYear,
          signals.month,
          signals.day,
          signals.hour,
          signals.minute,
        );
        reason = suggestedStartsAt
          ? `Partial date with assumed year ${options.assumeYear}. Not published automatically.`
          : `Partial date with assumed year ${options.assumeYear}, but constructed date is invalid.`;
      } else {
        reason = `Partial date (${signals.day} month) with assumed year ${options.assumeYear}, but no time found. Cannot build starts_at.`;
      }
    } else if (signals.hasFullDate) {
      reason = parsedDate?.warning ?? 'Full date found but no reliable time. Cannot build starts_at.';
    } else {
      reason = parsedDate?.warning ?? 'Day and month found, but no year. Use --assume-year YYYY to provide one.';
    }
  } else if (dateConfidence === 'recurring_rule') {
    reason = 'Recurring schedule (day-of-week or Shabbat). No specific start date can be determined automatically.';
  } else {
    reason = parsedDate?.warning ?? 'No usable date or time information found.';
  }

  return {
    dateConfidence,
    dateStatus,
    reason,
    rawDateText: parsedDate?.rawDateText ?? null,
    rawTimeText: signals.hasTime
      ? `${signals.hour}:${String(signals.minute).padStart(2, '0')}`
      : null,
    inferred: false,
    assumedYear,
    suggestedStartsAt,
    parserVersion: PARSER_VERSION,
  };
}

// ============================================================
// Location / category helpers
// ============================================================

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

// ============================================================
// Detail page parser
// ============================================================

function parseDetailPage(html, card, sourceUrl, options = {}) {
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

  // Date confidence classification
  const signals = extractDateSignals(parsedDate.rawDateText, card.rawTimeText);
  let dateConfidence = classifyDateConfidence(signals);

  if (parsedDate.startsAt) {
    // Trust the confident parser result over signal-based classification
    dateConfidence = 'confident';
  }

  const importReview = buildImportReview(signals, dateConfidence, parsedDate, options);

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
    dateConfidence,
    importReview,
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
      parser_version: PARSER_VERSION,
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
      importReview,
    },
  };
}

// ============================================================
// Website events fetcher
// ============================================================

async function parseWebsiteEvents(options) {
  const listHtml = await fetchHtml(options.sourceUrl, options.verbose);
  const cards = parseListPage(listHtml, options.sourceUrl);
  const limitedCards = options.limit ? cards.slice(0, options.limit) : cards;
  const parsedItems = [];

  for (const card of limitedCards) {
    try {
      const detailHtml = await fetchHtml(card.detailUrl, options.verbose);
      parsedItems.push({
        item: parseDetailPage(detailHtml, card, options.sourceUrl, options),
        error: null,
      });
    } catch (error) {
      parsedItems.push({
        item: {
          externalId: card.externalId,
          sourceUrl: card.detailUrl,
          title: card.title || card.detailUrl,
          startsAt: null,
          dateConfidence: 'none',
          importReview: null,
          parsedLocation: null,
          rawPayload: {
            parser_name: PARSER_NAME,
            parser_version: PARSER_VERSION,
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

// ============================================================
// Console output
// ============================================================

function printDryRunSummary(result, options = {}) {
  const errorItems = result.items.filter(({ error }) => Boolean(error));
  const nonErrorItems = result.items.filter(({ error }) => !error);
  const confident = nonErrorItems.filter(({ item }) => item.dateConfidence === 'confident');
  const partial = nonErrorItems.filter(({ item }) => item.dateConfidence === 'partial');
  const recurringRule = nonErrorItems.filter(({ item }) => item.dateConfidence === 'recurring_rule');
  const noneItems = nonErrorItems.filter(({ item }) => item.dateConfidence === 'none');

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

    console.log(`   dateConfidence: ${item.dateConfidence}`);
    console.log(`   category/audience: ${item.category}/${item.audience}`);
    console.log(`   image_url: ${item.imageUrl ?? '(none)'}`);
    console.log(`   registration: ${item.registrationMode}${item.registrationUrl ? ` (${item.registrationUrl})` : ''}`);
    console.log(`   raw_date_text: ${item.rawDateText ?? '(none)'}`);

    if (item.startsAt) {
      console.log(`   starts_at: ${item.startsAt}`);
    } else {
      const review = item.importReview;
      console.log(`   reason: ${review?.reason ?? item.dateWarning ?? '(none)'}`);

      if (review?.suggestedStartsAt) {
        console.log(`   suggestedStartsAt: ${review.suggestedStartsAt}`);
      }
    }
  });

  console.log('');
  console.log('Dry-run summary:');
  console.log(`  found_on_list=${result.foundOnList}, parsed=${result.items.length}`);
  console.log(`  confident=${confident.length}, partial=${partial.length}, recurring_rule=${recurringRule.length}, none=${noneItems.length}, errors=${errorItems.length}`);

  if (options.assumeYear) {
    const withSuggested = partial.filter(({ item }) => item.importReview?.suggestedStartsAt).length;
    console.log(`  partial_with_suggested_starts_at=${withSuggested} (assuming year ${options.assumeYear})`);
  }

  if (confident.length === 0) {
    console.log('');
    console.log('  No confident dates found. Events with partial/recurring/unknown dates are not published automatically.');
    console.log('  Run "npm run import:events:review" after an apply to inspect items needing review.');

    if (!options.assumeYear && partial.length > 0) {
      console.log('  For partial dates (day+month), try: --assume-year YYYY --create-drafts');
    }
  }
}

function printApplySummary(summary) {
  console.log('');
  console.log(`Apply summary: run_id=${summary.runId}`);
  console.log(`  found=${summary.foundCount}`);
  console.log(`  confident=${summary.confidentCount}, partial=${summary.partialCount}, recurring_rule=${summary.recurringRuleCount}, none=${summary.noneCount}`);
  console.log(`  created=${summary.createdCount}, updated=${summary.updatedCount}, ignored=${summary.ignoredCount}`);
  console.log(`  needs_review=${summary.needsReviewCount}, item_errors=${summary.errorCount}, manual_override_skipped=${summary.manualOverrideCount}`);
}

// ============================================================
// Database operations
// ============================================================

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

function buildEventValues(item, communityId, overrides = {}) {
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
    visibility: overrides.visibility ?? 'public',
    status: overrides.status ?? 'published',
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
        $20, $21, $22, $23, $24, $25,
        case when $15 = 'published' then now() else null end
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
        published_at = case
          when $15 = 'published' then coalesce(public.events.published_at, now())
          else public.events.published_at
        end
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

async function createOrUpdateEvent(client, item, communityId, overrides = {}) {
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

  const values = buildEventValues(item, communityId, overrides);

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

// ============================================================
// Apply import
// ============================================================

async function applyImport(options) {
  const client = await connectDatabase();
  let run = null;
  const summary = {
    foundCount: 0,
    confidentCount: 0,
    partialCount: 0,
    recurringRuleCount: 0,
    noneCount: 0,
    createdCount: 0,
    updatedCount: 0,
    ignoredCount: 0,
    needsReviewCount: 0,
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

      const { dateConfidence, importReview } = item;

      // Track by confidence
      if (dateConfidence === 'confident') {
        summary.confidentCount += 1;
      } else if (dateConfidence === 'partial') {
        summary.partialCount += 1;
      } else if (dateConfidence === 'recurring_rule') {
        summary.recurringRuleCount += 1;
      } else {
        summary.noneCount += 1;
      }

      if (dateConfidence === 'confident') {
        // Create or update published event
        const eventResult = await createOrUpdateEvent(client, item, communityId);

        if (eventResult.action === 'created') {
          summary.createdCount += 1;
        } else if (eventResult.action === 'updated') {
          summary.updatedCount += 1;
        } else {
          summary.ignoredCount += 1;
          summary.manualOverrideCount += 1;
        }

        const isManualOverride = eventResult.action === 'manual_override';
        const itemStatus = isManualOverride ? 'ignored' : 'linked';
        const reviewWithOverride = isManualOverride
          ? { ...importReview, reason: `${importReview?.reason ?? ''} manual_override protected.`.trim() }
          : importReview;

        await insertImportItem(
          client,
          source.id,
          run.id,
          item,
          itemStatus,
          eventResult.eventId,
          {
            ...item.rawPayload,
            import_status: itemStatus,
            import_status_reason: isManualOverride
              ? 'Existing event has manual_override = true.'
              : null,
            linked_event_id: eventResult.eventId,
            event_action: eventResult.action,
            importReview: reviewWithOverride,
          },
        );
      } else {
        // Non-confident date: decide whether to create a draft or mark as needs_review
        const canCreateDraft = options.createDrafts
          && importReview?.suggestedStartsAt != null;

        if (canCreateDraft) {
          // Build a draft item with the suggested starts_at
          const draftItem = {
            ...item,
            startsAt: importReview.suggestedStartsAt,
          };

          const eventResult = await createOrUpdateEvent(client, draftItem, communityId, {
            status: 'draft',
            visibility: 'hidden',
          });

          if (eventResult.action === 'created') {
            summary.createdCount += 1;
          } else if (eventResult.action === 'updated') {
            summary.updatedCount += 1;
          } else {
            summary.ignoredCount += 1;
            summary.manualOverrideCount += 1;
          }

          const isManualOverride = eventResult.action === 'manual_override';
          const itemStatus = isManualOverride ? 'ignored' : 'linked';
          const draftReview = {
            ...importReview,
            draftEventCreated: !isManualOverride,
            draftEventId: eventResult.eventId,
          };

          await insertImportItem(
            client,
            source.id,
            run.id,
            item,
            itemStatus,
            eventResult.eventId,
            {
              ...item.rawPayload,
              import_status: isManualOverride ? 'ignored' : 'draft_linked',
              import_status_reason: isManualOverride
                ? 'Existing event has manual_override = true.'
                : `Draft event ${eventResult.action} with starts_at=${importReview.suggestedStartsAt}.`,
              linked_event_id: eventResult.eventId,
              event_action: `draft_${eventResult.action}`,
              importReview: draftReview,
            },
          );

          console.warn(
            `[draft] ${item.title}: draft event ${eventResult.action} (starts_at=${importReview.suggestedStartsAt})`,
          );
        } else {
          // Save as needs_review (status='ignored' in DB, dateStatus='needs_review' in importReview)
          summary.ignoredCount += 1;
          summary.needsReviewCount += 1;

          const draftSkipReason = options.createDrafts
            ? `No suggestedStartsAt available for draft creation (dateConfidence=${dateConfidence}).`
            : null;

          await insertImportItem(client, source.id, run.id, item, 'ignored', null, {
            ...item.rawPayload,
            import_status: 'ignored',
            import_status_reason: importReview?.reason ?? item.dateWarning,
            importReview: draftSkipReason
              ? { ...importReview, draftSkipReason }
              : importReview,
          });

          console.warn(`[needs_review] ${item.title}: ${importReview?.reason ?? item.dateWarning}`);
        }
      }
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

// ============================================================
// Review report
// ============================================================

async function runReviewReport(options) {
  const client = await connectDatabase();

  try {
    const limit = options.limit ?? 50;

    // Recent runs
    const runsResult = await client.query(
      `
        select id, status, started_at, finished_at, found_count, created_count, updated_count
        from public.event_import_runs
        order by started_at desc
        limit 5
      `,
    );

    console.log('=== Recent Import Runs ===');

    if (runsResult.rows.length === 0) {
      console.log('  (no runs found — run "npm run import:events -- --apply" first)');
    } else {
      for (const run of runsResult.rows) {
        const started = run.started_at instanceof Date
          ? run.started_at.toISOString()
          : run.started_at ?? 'unknown';
        console.log(`  run_id=${run.id}`);
        console.log(`    started=${started}, status=${run.status}`);
        console.log(`    found=${run.found_count}, created=${run.created_count}, updated=${run.updated_count}`);
      }
    }

    console.log('');

    // Items needing review
    const itemsResult = await client.query(
      `
        select
          i.id,
          i.parsed_title,
          i.source_url,
          i.status,
          i.raw_payload,
          i.parsed_starts_at,
          i.linked_event_id,
          i.created_at,
          r.started_at as run_started_at
        from public.event_import_items i
        left join public.event_import_runs r on r.id = i.run_id
        where i.status in ('ignored', 'error')
        order by i.created_at desc
        limit $1
      `,
      [limit],
    );

    console.log(`=== Items Needing Review (limit=${limit}) ===`);

    if (itemsResult.rows.length === 0) {
      console.log('  (no items needing review)');
      return;
    }

    for (let i = 0; i < itemsResult.rows.length; i += 1) {
      const row = itemsResult.rows[i];
      const review = row.raw_payload?.importReview ?? null;
      const runStarted = row.run_started_at instanceof Date
        ? row.run_started_at.toISOString()
        : row.run_started_at ?? 'unknown';

      console.log(`${i + 1}. ${row.parsed_title ?? '(no title)'}`);
      console.log(`   source_url:      ${row.source_url ?? '(none)'}`);
      console.log(`   status:          ${row.status}`);
      console.log(`   linked_event_id: ${row.linked_event_id ?? '(none)'}`);
      console.log(`   run_started_at:  ${runStarted}`);

      if (review) {
        console.log(`   dateConfidence:  ${review.dateConfidence ?? '(unknown)'}`);
        console.log(`   dateStatus:      ${review.dateStatus ?? '(unknown)'}`);
        console.log(`   reason:          ${review.reason ?? '(none)'}`);
        console.log(`   rawDateText:     ${review.rawDateText ?? '(none)'}`);
        console.log(`   rawTimeText:     ${review.rawTimeText ?? '(none)'}`);

        if (review.assumedYear) {
          console.log(`   assumedYear:     ${review.assumedYear}`);
        }

        if (review.suggestedStartsAt) {
          console.log(`   suggestedStartsAt: ${review.suggestedStartsAt}`);
        }
      } else {
        const legacyReason = row.raw_payload?.import_status_reason;

        if (legacyReason) {
          console.log(`   reason:          ${legacyReason}`);
        }
      }

      console.log('');
    }

    // Summary by confidence
    const byConfidence = {};

    for (const row of itemsResult.rows) {
      const confidence = row.raw_payload?.importReview?.dateConfidence ?? 'legacy/unknown';
      byConfidence[confidence] = (byConfidence[confidence] ?? 0) + 1;
    }

    console.log('=== Review Summary ===');

    for (const [confidence, count] of Object.entries(byConfidence)) {
      console.log(`  ${confidence}: ${count}`);
    }

    console.log('');
    console.log('To create draft events for partial dates with a known year:');
    console.log('  npm run import:events -- --apply --assume-year YYYY --create-drafts');
  } finally {
    await client.end();
  }
}

// ============================================================
// Entry point
// ============================================================

async function main() {
  loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));

  if (options.review) {
    console.log('Mode: review');

    if (options.limit) {
      console.log(`Limit: ${options.limit}`);
    }

    console.log('');
    await runReviewReport(options);
    return;
  }

  console.log(`Mode: ${options.apply ? 'apply' : 'dry-run'}`);
  console.log(`Source URL: ${options.sourceUrl}`);

  if (options.limit) {
    console.log(`Limit: ${options.limit}`);
  }

  if (options.assumeYear) {
    console.log(`Assume year: ${options.assumeYear}`);
  }

  if (options.createDrafts) {
    console.log('Create drafts: yes');
  }

  console.log('');

  if (options.dryRun) {
    const result = await parseWebsiteEvents(options);
    printDryRunSummary(result, options);
    return;
  }

  const summary = await applyImport(options);
  printApplySummary(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
