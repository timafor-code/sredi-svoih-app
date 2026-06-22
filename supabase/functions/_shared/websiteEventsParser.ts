// @ts-nocheck
import { load } from "npm:cheerio@1.2.0/slim";

export const DEFAULT_WEBSITE_EVENTS_SOURCE_URL =
  "https://www.sredisvoih.com/events/";
export const WEBSITE_EVENTS_PARSER_NAME = "sredi_svoih_events";
export const WEBSITE_EVENTS_PARSER_VERSION = "1.1.0";
export const DEFAULT_DRY_RUN_LIMIT = 10;
export const MAX_DRY_RUN_LIMIT = 20;
export const DEFAULT_DETAIL_FETCH_CONCURRENCY = 3;
export const MAX_DETAIL_FETCH_CONCURRENCY = 3;
export const DEFAULT_REQUEST_TIMEOUT_MS = 9_000;
export const MAX_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_OVERALL_TIMEOUT_MS = 45_000;

const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MIN_OVERALL_TIMEOUT_MS = 5_000;
const MAX_OVERALL_TIMEOUT_MS = 50_000;
const DEDUPE_CONTRACT_VERSION = 1;
const DEFAULT_LOCATION_NAME = "Среди Своих";
const DEFAULT_ADDRESS = "Москва, ул. Льва Толстого, 14";
const DEFAULT_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  "user-agent":
    "sredi-svoih-edge-events-dry-run/1.0 (+https://github.com/timafor-code/sredi-svoih-app)",
};

const monthNumbers = new Map([
  ["января", 1],
  ["январь", 1],
  ["февраля", 2],
  ["февраль", 2],
  ["марта", 3],
  ["март", 3],
  ["апреля", 4],
  ["апрель", 4],
  ["мая", 5],
  ["май", 5],
  ["июня", 6],
  ["июнь", 6],
  ["июля", 7],
  ["июль", 7],
  ["августа", 8],
  ["август", 8],
  ["сентября", 9],
  ["сентябрь", 9],
  ["октября", 10],
  ["октябрь", 10],
  ["ноября", 11],
  ["ноябрь", 11],
  ["декабря", 12],
  ["декабрь", 12],
]);

const monthPattern = [...monthNumbers.keys()].join("|");
const textEncoder = new TextEncoder();

export class WebsiteEventsParserError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "WebsiteEventsParserError";
    this.code = code;
    this.url = options.url ?? null;
    this.cause = options.cause;
  }
}

export function normalizeDryRunOptions(input = {}) {
  const sourceUrl = normalizeSourceUrl(
    readString(input.sourceUrl) ?? DEFAULT_WEBSITE_EVENTS_SOURCE_URL,
  );
  const requestedLimit = readOptionalInteger(input.limit, "limit");
  const limit = Math.min(requestedLimit ?? DEFAULT_DRY_RUN_LIMIT, MAX_DRY_RUN_LIMIT);
  const requestedConcurrency = readOptionalInteger(
    input.detailFetchConcurrency ?? input.detailConcurrency,
    "detailFetchConcurrency",
  );
  const detailFetchConcurrency = Math.min(
    requestedConcurrency ?? DEFAULT_DETAIL_FETCH_CONCURRENCY,
    MAX_DETAIL_FETCH_CONCURRENCY,
  );
  const requestTimeoutMs = clampOptionalInteger(
    input.requestTimeoutMs,
    "requestTimeoutMs",
    DEFAULT_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
  );
  const overallTimeoutMs = clampOptionalInteger(
    input.overallTimeoutMs,
    "overallTimeoutMs",
    DEFAULT_OVERALL_TIMEOUT_MS,
    MIN_OVERALL_TIMEOUT_MS,
    MAX_OVERALL_TIMEOUT_MS,
  );
  const assumeYear = readAssumeYear(input.assumeYear);
  const fetchDetails = input.fetchDetails === false ? false : true;

  if (limit < 1) {
    throw new WebsiteEventsParserError(
      "invalid_limit",
      "limit must be a positive integer.",
    );
  }

  if (detailFetchConcurrency < 1) {
    throw new WebsiteEventsParserError(
      "invalid_detail_fetch_concurrency",
      "detailFetchConcurrency must be a positive integer.",
    );
  }

  return {
    sourceUrl,
    limit,
    maxLimit: MAX_DRY_RUN_LIMIT,
    fetchDetails,
    detailFetchConcurrency,
    requestTimeoutMs,
    overallTimeoutMs,
    assumeYear,
  };
}

export async function parseWebsiteEventsDryRun(input = {}) {
  const options = normalizeDryRunOptions(input);
  const timeoutGuard = createTimeoutGuard(options.overallTimeoutMs);
  const listHtml = await fetchHtml(options.sourceUrl, {
    phase: "list",
    requestTimeoutMs: options.requestTimeoutMs,
    timeoutGuard,
  });
  const listParseErrors = [];
  let cards = [];

  try {
    cards = await parseListPage(listHtml, options.sourceUrl);
  } catch (error) {
    listParseErrors.push(toSafeParserError(error, "list_parse_failed"));
  }

  const limitedCards = cards.slice(0, options.limit);
  const items = options.fetchDetails
    ? await mapWithConcurrency(
      limitedCards,
      options.detailFetchConcurrency,
      (card, index) => parseCardWithDetail(card, index, options, timeoutGuard),
    )
    : await Promise.all(
      limitedCards.map((card, index) => parseCardOnlyResult(card, index, options)),
    );
  const parserErrors = [
    ...listParseErrors,
    ...items.filter((result) => result.error).map((result) => ({
      index: result.index + 1,
      title: result.item.title,
      sourceUrl: result.item.sourceUrl,
      sourceExternalId: result.item.sourceExternalId,
      ...toSafeParserError(result.error, "detail_parse_failed"),
    })),
  ];
  const parsedCount = items.filter((result) => !result.error).length;

  return {
    parserName: WEBSITE_EVENTS_PARSER_NAME,
    parserVersion: WEBSITE_EVENTS_PARSER_VERSION,
    sourceUrl: options.sourceUrl,
    options,
    foundCount: cards.length,
    parsedCount,
    errorCount: parserErrors.length,
    items,
    summary: {
      foundCount: cards.length,
      requestedCount: limitedCards.length,
      parsedCount,
      errorCount: parserErrors.length,
      itemsPreview: items.map(toItemPreview),
      parserErrors,
    },
  };
}

export function toSafeParserError(error, fallbackCode = "parser_error") {
  const code =
    error instanceof WebsiteEventsParserError ? error.code : fallbackCode;
  const url = error instanceof WebsiteEventsParserError ? error.url : null;
  const message = sanitizeErrorMessage(
    error instanceof Error ? error.message : String(error),
  );

  return {
    code,
    message,
    ...(url ? { url } : {}),
  };
}

async function parseCardWithDetail(card, index, options, timeoutGuard) {
  try {
    timeoutGuard.assertCanContinue("detail fetch");
    const detailHtml = await fetchHtml(card.sourceUrl, {
      phase: "detail",
      requestTimeoutMs: options.requestTimeoutMs,
      timeoutGuard,
    });
    const item = await parseDetailPage(detailHtml, card, options.sourceUrl, options);

    return { index, item, error: null };
  } catch (error) {
    const parserError = error instanceof WebsiteEventsParserError
      ? error
      : new WebsiteEventsParserError(
        "detail_parse_failed",
        error instanceof Error ? error.message : String(error),
        { url: card.sourceUrl, cause: error },
      );
    const item = await buildErrorItem(card, parserError);

    return { index, item, error: parserError };
  }
}

async function parseCardOnlyResult(card, index, options) {
  try {
    const item = await parseCardOnly(card, options);

    return { index, item, error: null };
  } catch (error) {
    const parserError = error instanceof WebsiteEventsParserError
      ? error
      : new WebsiteEventsParserError(
        "card_parse_failed",
        error instanceof Error ? error.message : String(error),
        { url: card.sourceUrl, cause: error },
      );
    const item = await buildErrorItem(card, parserError);

    return { index, item, error: parserError };
  }
}

async function fetchHtml(url, options) {
  const remainingMs = options.timeoutGuard.remainingMs();

  if (remainingMs <= 0) {
    throw new WebsiteEventsParserError(
      "overall_timeout",
      `Overall timeout guard reached before ${options.phase} fetch.`,
      { url },
    );
  }

  const requestTimeoutMs = Math.max(
    1,
    Math.min(options.requestTimeoutMs, remainingMs),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: DEFAULT_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new WebsiteEventsParserError(
        "http_error",
        `HTTP ${response.status} ${response.statusText}`,
        { url },
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof WebsiteEventsParserError) {
      throw error;
    }

    if (controller.signal.aborted) {
      const code = requestTimeoutMs < options.requestTimeoutMs
        ? "overall_timeout"
        : "request_timeout";
      throw new WebsiteEventsParserError(
        code,
        `${options.phase} fetch timed out after ${requestTimeoutMs}ms.`,
        { url, cause: error },
      );
    }

    throw new WebsiteEventsParserError(
      "fetch_failed",
      `${options.phase} fetch failed.`,
      { url, cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function parseListPage(html, sourceUrl) {
  const $ = load(html);
  const cards = [];

  $(".events__event").each((_, element) => {
    const card = $(element);
    const detailHref = card.find("a.events__event__link").first().attr("href") ??
      card.find('a[href*="/events/"]').first().attr("href");
    const detailUrl = absoluteUrl(detailHref, sourceUrl);
    const canonicalDetailUrl = detailUrl ? normalizeSourceUrl(detailUrl) : null;

    if (!canonicalDetailUrl || isEventsIndexUrl(canonicalDetailUrl)) {
      return;
    }

    const imageSrc = card.find("img").first().attr("src") ?? null;
    const title = normalizeTitle(
      card.find("h5").first().text() ||
        card.find("img").first().attr("alt") ||
        card.find("a").first().text(),
    );
    const hidden = card.find(".events__event__hidden").first().clone();
    hidden.find("h5, a, svg").remove();
    const rawShortText = textWithBreaks($, hidden);
    const rawCategory = compactText(card.attr("data-tab-content") ?? "")
      .split(/\s+/)
      .filter((item) => item && item.toLowerCase() !== "all")
      .join(" ") || null;
    const timeText = compactText(card.find(".time").first().text());

    cards.push({
      sourceUrl: canonicalDetailUrl,
      title,
      imageUrl: absoluteUrl(imageSrc, sourceUrl),
      shortDescription: shortText(rawShortText),
      rawCategory,
      rawTimeText: timeText || null,
      rawCardPayload: {
        element_id: card.attr("id") ?? null,
        data_tab_content: card.attr("data-tab-content") ?? null,
        detail_href: detailHref ?? null,
        detail_url: canonicalDetailUrl,
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
      const detailUrl = absoluteUrl($(element).attr("href"), sourceUrl);
      const canonicalDetailUrl = detailUrl ? normalizeSourceUrl(detailUrl) : null;

      if (!canonicalDetailUrl || isEventsIndexUrl(canonicalDetailUrl)) {
        return;
      }

      cards.push({
        sourceUrl: canonicalDetailUrl,
        title: normalizeTitle($(element).text()),
        imageUrl: null,
        shortDescription: null,
        rawCategory: null,
        rawTimeText: null,
        rawCardPayload: {
          detail_url: canonicalDetailUrl,
          link_text: compactText($(element).text()),
          html: $.html(element),
        },
      });
    });
  }

  const seen = new Set();
  const uniqueCards = cards.filter((card) => {
    const key = card.sourceUrl;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  return await Promise.all(
    uniqueCards.map(async (card) => ({
      ...card,
      sourceExternalId: await sourceExternalIdFromUrl(card.sourceUrl),
    })),
  );
}

async function parseCardOnly(card, options = {}) {
  const title = normalizeTitle(card.title || card.sourceUrl);
  const description = card.shortDescription || null;
  const rawDateText = extractRelevantDateText(
    description,
    null,
    card.rawTimeText,
  );
  const parsedDate = parseConfidentStartsAt(rawDateText);
  const signals = extractDateSignals(parsedDate.rawDateText, card.rawTimeText);
  let dateConfidence = classifyDateConfidence(signals);

  if (parsedDate.startsAt) {
    dateConfidence = "confident";
  }

  const category = inferCategory(title, card.rawCategory);
  const audience = inferAudience(category, title);
  const importReview = buildImportReview(signals, dateConfidence, parsedDate, options);
  importReview.dedupe = await buildDedupe({
    title,
    startsAt: parsedDate.startsAt,
    description,
    sourceUrl: card.sourceUrl,
    sourceExternalId: card.sourceExternalId,
  });

  return {
    sourceExternalId: card.sourceExternalId,
    sourceUrl: card.sourceUrl,
    title,
    imageUrl: card.imageUrl,
    description,
    shortDescription: shortText(description ?? title),
    startsAt: parsedDate.startsAt,
    rawDateText: parsedDate.rawDateText,
    dateWarning: parsedDate.warning,
    dateConfidence,
    importReview,
    locationName: DEFAULT_LOCATION_NAME,
    address: DEFAULT_ADDRESS,
    parsedLocation: null,
    registrationMode: "none",
    registrationUrl: null,
    category,
    audience,
    rawCategory: card.rawCategory,
    rawPayload: {
      parser_name: WEBSITE_EVENTS_PARSER_NAME,
      parser_version: WEBSITE_EVENTS_PARSER_VERSION,
      detail_fetch_skipped: true,
      card: card.rawCardPayload,
      parsed: {
        source_external_id: card.sourceExternalId,
        title,
        starts_at: parsedDate.startsAt,
        raw_date_text: parsedDate.rawDateText,
        date_warning: parsedDate.warning,
        category,
        audience,
      },
      importReview,
    },
  };
}

async function parseDetailPage(html, card, sourceUrl, options = {}) {
  const $ = load(html);
  const title = normalizeTitle(
    $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text() ||
      card.title,
  );
  const head = $(".event-page__head").first();
  const detailDescription = textWithBreaks($, head.find("h4").first());
  const description = detailDescription || card.shortDescription || null;
  const imageUrl = absoluteUrl(
    head.find("img").first().attr("src") ??
      $('meta[property="og:image"]').attr("content") ??
      card.imageUrl,
    sourceUrl,
  );
  const dateBlock = compactText(head.find(".event-page__head__date").first().text());
  const rawDateText = extractRelevantDateText(
    description,
    dateBlock,
    card.rawTimeText,
  );
  const parsedDate = parseConfidentStartsAt(rawDateText);
  const category = inferCategory(title, card.rawCategory);
  const audience = inferAudience(category, title);
  const location = inferLocation(description);
  const registrationUrl = findRegistrationUrl($, sourceUrl, card.sourceUrl);
  const signals = extractDateSignals(parsedDate.rawDateText, card.rawTimeText);
  let dateConfidence = classifyDateConfidence(signals);

  if (parsedDate.startsAt) {
    dateConfidence = "confident";
  }

  const importReview = buildImportReview(signals, dateConfidence, parsedDate, options);
  importReview.dedupe = await buildDedupe({
    title,
    startsAt: parsedDate.startsAt,
    description,
    sourceUrl: card.sourceUrl,
    sourceExternalId: card.sourceExternalId,
  });

  return {
    sourceExternalId: card.sourceExternalId,
    sourceUrl: card.sourceUrl,
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
    registrationMode: registrationUrl ? "external_link" : "none",
    registrationUrl,
    category,
    audience,
    rawCategory: card.rawCategory,
    rawPayload: {
      parser_name: WEBSITE_EVENTS_PARSER_NAME,
      parser_version: WEBSITE_EVENTS_PARSER_VERSION,
      card: card.rawCardPayload,
      detail: {
        source_url: card.sourceUrl,
        title,
        image_url: imageUrl,
        date_text: dateBlock || null,
        description,
        registration_url: registrationUrl,
        html,
      },
      parsed: {
        source_external_id: card.sourceExternalId,
        title,
        starts_at: parsedDate.startsAt,
        raw_date_text: parsedDate.rawDateText,
        date_warning: parsedDate.warning,
        location_name: location.locationName,
        address: location.address,
        parsed_location: location.parsedLocation,
        category,
        audience,
        registration_mode: registrationUrl ? "external_link" : "none",
        registration_url: registrationUrl,
      },
      importReview,
    },
  };
}

async function buildErrorItem(card, error) {
  const safeError = toSafeParserError(error, "detail_parse_failed");
  const title = normalizeTitle(card.title || card.sourceUrl);
  const dedupe = await buildDedupe(
    {
      title,
      startsAt: null,
      description: null,
      sourceUrl: card.sourceUrl,
      sourceExternalId: card.sourceExternalId,
    },
    {
      status: "error",
      reason: safeError.message,
    },
  );

  return {
    sourceExternalId: card.sourceExternalId,
    sourceUrl: card.sourceUrl,
    title,
    imageUrl: card.imageUrl,
    description: null,
    shortDescription: card.shortDescription,
    startsAt: null,
    rawDateText: null,
    dateWarning: safeError.message,
    dateConfidence: "none",
    importReview: {
      dateConfidence: "none",
      dateStatus: "needs_review",
      reason: safeError.message,
      rawDateText: null,
      rawTimeText: null,
      inferred: false,
      assumedYear: null,
      suggestedStartsAt: null,
      parserVersion: WEBSITE_EVENTS_PARSER_VERSION,
      dedupe,
    },
    locationName: DEFAULT_LOCATION_NAME,
    address: DEFAULT_ADDRESS,
    parsedLocation: null,
    registrationMode: "none",
    registrationUrl: null,
    category: inferCategory(title, card.rawCategory),
    audience: "all",
    rawCategory: card.rawCategory,
    rawPayload: {
      parser_name: WEBSITE_EVENTS_PARSER_NAME,
      parser_version: WEBSITE_EVENTS_PARSER_VERSION,
      card: card.rawCardPayload,
      parse_error: safeError,
    },
  };
}

function toItemPreview(result) {
  const item = result.item;
  const dedupe = item.importReview?.dedupe ?? null;

  return {
    index: result.index + 1,
    title: item.title,
    sourceUrl: item.sourceUrl,
    canonicalSourceUrl: dedupe?.canonicalSourceUrl ?? canonicalizeSourceUrl(item.sourceUrl),
    sourceExternalId: item.sourceExternalId,
    contentHash: dedupe?.contentHash ?? null,
    dateConfidence: item.dateConfidence,
    startsAt: item.startsAt,
    rawDateText: item.rawDateText,
    category: item.category,
    audience: item.audience,
    registrationMode: item.registrationMode,
    registrationUrl: item.registrationUrl,
    imageUrl: item.imageUrl,
    error: result.error ? toSafeParserError(result.error, "detail_parse_failed") : null,
  };
}

function cleanText(value) {
  return (value ?? "")
    .replace(/\r/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function textWithBreaks($, selection) {
  const clone = selection.clone();
  clone.find("script, style, svg").remove();
  clone.find("br").replaceWith("\n");
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

export function normalizeSourceUrl(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }

    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    throw new WebsiteEventsParserError(
      "invalid_source_url",
      "sourceUrl must be a valid http(s) URL.",
    );
  }
}

function canonicalizeSourceUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return normalizeSourceUrl(value);
  } catch {
    return value;
  }
}

async function sourceExternalIdFromUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = parts.at(-1);

  if (slug && slug !== "events") {
    return decodeURIComponent(slug).toLowerCase();
  }

  return (await sha256Hex(url.href)).slice(0, 16);
}

function isEventsIndexUrl(value) {
  try {
    return new URL(value).pathname.replace(/\/+$/, "") === "/events";
  } catch {
    return false;
  }
}

function normalizeTitle(title) {
  return compactText(title)
    .replace(/\s+[|—-]\s+Среди\s+Своих$/i, "")
    .replace(/\s+[|—-]\s+Еврейская\s+община.*$/i, "")
    .trim();
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

  const labelRegex =
    /(?:когда|дата|дата и время|начало(?: занятий)?|расписание|время)\s*:\s*([^.;]+(?:[.;]|$))/giu;
  for (const match of text.matchAll(labelRegex)) {
    candidates.push(match[0]);
  }

  const monthRegex = new RegExp(
    `.{0,36}\\b\\d{1,2}\\s+(?:${monthPattern})\\b.{0,56}`,
    "giu",
  );
  for (const match of text.matchAll(monthRegex)) {
    candidates.push(match[0]);
  }

  const numericDateRegex =
    /.{0,36}\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.{0,56}/gu;
  for (const match of text.matchAll(numericDateRegex)) {
    candidates.push(match[0]);
  }

  return candidates.map(compactText).filter(Boolean).join(" | ");
}

function findTimeNear(text, index) {
  const windowText = text.slice(index, index + 100);
  const timeMatch = windowText.match(
    /(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)/u,
  );

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
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${
    String(month).padStart(2, "0")
  }-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${
    String(minute).padStart(2, "0")
  }:00+03:00`;
}

function parseConfidentStartsAt(rawDateText) {
  const text = compactText(rawDateText);

  if (!text) {
    return {
      startsAt: null,
      rawDateText: null,
      warning: "No date text found on the card or detail page.",
    };
  }

  const ruDateRegex = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\s*(?:г\\.?|года)?)?`,
    "iu",
  );
  const ruDateMatch = ruDateRegex.exec(text);

  if (ruDateMatch?.index !== undefined) {
    const time = findTimeNear(text, ruDateMatch.index);

    if (!time) {
      return {
        startsAt: null,
        rawDateText: text,
        warning: "Full date has a year, but no reliable time was found.",
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
      : { startsAt: null, rawDateText: text, warning: "Parsed date is invalid." };
  }

  const numericDateRegex = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/u;
  const numericDateMatch = numericDateRegex.exec(text);

  if (numericDateMatch?.index !== undefined) {
    const time = findTimeNear(text, numericDateMatch.index);

    if (!time) {
      return {
        startsAt: null,
        rawDateText: text,
        warning: "Numeric date has a year, but no reliable time was found.",
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
      : {
        startsAt: null,
        rawDateText: text,
        warning: "Parsed numeric date is invalid.",
      };
  }

  const partialRuDateRegex = new RegExp(
    `\\b\\d{1,2}\\s+(?:${monthPattern})\\b`,
    "iu",
  );
  const hasPartialDate = partialRuDateRegex.test(text);
  const hasTime = /(?:^|\D)([01]?\d|2[0-3])[:.]\d{2}(?:\D|$)/u.test(text);

  return {
    startsAt: null,
    rawDateText: text,
    warning: hasPartialDate || hasTime
      ? "Only partial or recurring date/time text was found."
      : "No full date with year and time was found.",
  };
}

function extractDateSignals(rawDateText, rawTimeText) {
  const text = compactText(rawDateText ?? "");
  const timeText = compactText(rawTimeText ?? "");
  const allText = [text, timeText].filter(Boolean).join(" ");
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
  const ruFullRegex = new RegExp(
    `\\b(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\s*(?:г\\.?|года)?)?`,
    "iu",
  );
  const ruFullMatch = ruFullRegex.exec(text);

  if (ruFullMatch) {
    signals.hasFullDate = true;
    signals.day = Number.parseInt(ruFullMatch[1], 10);
    signals.month = monthNumbers.get(ruFullMatch[2].toLowerCase());
    signals.year = Number.parseInt(ruFullMatch[3], 10);
  }

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

  if (!signals.hasFullDate) {
    const ruPartialRegex = new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})`, "iu");
    const partialMatch = ruPartialRegex.exec(text);

    if (partialMatch) {
      signals.hasPartialDate = true;
      signals.day = Number.parseInt(partialMatch[1], 10);
      signals.month = monthNumbers.get(partialMatch[2].toLowerCase());
    }
  }

  const timeRegex = /(?:^|\D)([01]?\d|2[0-3])[:.](\d{2})(?:\D|$)/u;
  const timeMatch = timeRegex.exec(allText);

  if (timeMatch) {
    signals.hasTime = true;
    signals.hour = Number.parseInt(timeMatch[1], 10);
    signals.minute = Number.parseInt(timeMatch[2], 10);
  }

  const recurringDativRegex =
    /(?:^|[\s:,])по\s+(?:понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)/iu;
  const recurringEveryRegex =
    /кажд(?:ый|ое|ую)\s+(?:воскресенье|понедельник|вторник|среду|четверг|пятницу|субботу)/iu;

  if (recurringDativRegex.test(allText) || recurringEveryRegex.test(allText)) {
    signals.hasRecurringDayOfWeek = true;
  }

  if (/шабб?ат/iu.test(allText)) {
    signals.hasRecurringDayOfWeek = true;
  }

  return signals;
}

function classifyDateConfidence(signals) {
  if (signals.hasFullDate && signals.hasTime) {
    return "confident";
  }

  if (signals.hasFullDate || signals.hasPartialDate) {
    return "partial";
  }

  if (signals.hasRecurringDayOfWeek) {
    return "recurring_rule";
  }

  return "none";
}

function buildImportReview(signals, dateConfidence, parsedDate, options) {
  let suggestedStartsAt = null;
  let assumedYear = null;
  let dateStatus = "needs_review";
  let reason;

  if (dateConfidence === "confident") {
    dateStatus = "ready";
    reason = "Full date with year and time found.";
  } else if (dateConfidence === "partial") {
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
        reason =
          `Partial date (${signals.day}.${signals.month}) with assumed year ${options.assumeYear}, but no time found. Cannot build starts_at.`;
      }
    } else if (signals.hasFullDate) {
      reason = parsedDate?.warning ??
        "Full date found but no reliable time. Cannot build starts_at.";
    } else {
      reason = parsedDate?.warning ??
        "Day and month found, but no year. Use assumeYear to provide one.";
    }
  } else if (dateConfidence === "recurring_rule") {
    reason =
      "Recurring schedule (day-of-week or Shabbat). No specific start date can be determined automatically.";
  } else {
    reason = parsedDate?.warning ?? "No usable date or time information found.";
  }

  return {
    dateConfidence,
    dateStatus,
    reason,
    rawDateText: parsedDate?.rawDateText ?? null,
    rawTimeText: signals.hasTime
      ? `${signals.hour}:${String(signals.minute).padStart(2, "0")}`
      : null,
    inferred: false,
    assumedYear,
    suggestedStartsAt,
    parserVersion: WEBSITE_EVENTS_PARSER_VERSION,
  };
}

async function computeContentHash(item) {
  const normalized = [
    "v1",
    normalizeTitle(item.title ?? ""),
    item.startsAt ?? "",
    compactText(item.description ?? ""),
  ].join("\n");

  return `sha256:${await sha256Hex(normalized)}`;
}

async function buildDedupe(item, overrides = {}) {
  const contentHash = overrides.contentHash ?? await computeContentHash(item);

  return {
    version: DEDUPE_CONTRACT_VERSION,
    status: overrides.status ?? "new",
    reason: overrides.reason ?? "Parsed card; not yet checked against existing events.",
    matchedBy: overrides.matchedBy ?? [],
    matchedEventId: overrides.matchedEventId ?? null,
    matchedImportItemId: overrides.matchedImportItemId ?? null,
    manualOverride: overrides.manualOverride ?? false,
    contentHash,
    canonicalSourceUrl: canonicalizeSourceUrl(item.sourceUrl ?? null),
    sourceExternalId: item.sourceExternalId ?? null,
    checkedAt: new Date().toISOString(),
  };
}

function extractLabeledValue(text, labels) {
  const compact = compactText(text);

  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*:\\s*([^.;]+)`, "iu");
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
  const parsed = extractLabeledValue(description, ["Место", "Где", "Адрес"]);

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
  const text = `${title ?? ""} ${rawCategory ?? ""}`.toLocaleLowerCase("ru-RU");

  if (/шабб?ат/u.test(text)) {
    return "shabbat";
  }

  if (/детск|воскресн(?:ая|ой)\s+школ/u.test(text)) {
    return "children";
  }

  if (/песах|ханук|пурим|шавуот|суккот|симхат|рош\s+а?шана|йом\s+кипур|праздник/u.test(text)) {
    return "holiday";
  }

  if (/лекци/u.test(text)) {
    return "lecture";
  }

  if (/курс|изучени|иудаизм|истори|тора|философ/u.test(text)) {
    return "class";
  }

  return "community";
}

function inferAudience(category, title) {
  const text = (title ?? "").toLocaleLowerCase("ru-RU");

  if (category === "children" || /детск|воскресн(?:ая|ой)\s+школ/u.test(text)) {
    return "children";
  }

  return "all";
}

function findRegistrationUrl($, sourceUrl, detailUrl) {
  const candidates = [];

  $(".event-page__head a, main a").each((_, element) => {
    const link = $(element);
    const href = link.attr("href");
    const text = compactText(link.text()).toLocaleLowerCase("ru-RU");
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

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function createTimeoutGuard(overallTimeoutMs) {
  const startedAt = Date.now();

  return {
    remainingMs() {
      return overallTimeoutMs - (Date.now() - startedAt);
    },
    assertCanContinue(phase) {
      if (this.remainingMs() <= 0) {
        throw new WebsiteEventsParserError(
          "overall_timeout",
          `Overall timeout guard reached during ${phase}.`,
        );
      }
    },
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new WebsiteEventsParserError(
      `invalid_${fieldName}`,
      `${fieldName} must be an integer.`,
    );
  }

  return parsed;
}

function clampOptionalInteger(value, fieldName, defaultValue, min, max) {
  const parsed = readOptionalInteger(value, fieldName);

  if (parsed === null) {
    return defaultValue;
  }

  if (parsed < min) {
    throw new WebsiteEventsParserError(
      `invalid_${fieldName}`,
      `${fieldName} must be at least ${min}.`,
    );
  }

  return Math.min(parsed, max);
}

function readAssumeYear(value) {
  const year = readOptionalInteger(value, "assumeYear");

  if (year === null) {
    return null;
  }

  if (year < 2000 || year > 2100) {
    throw new WebsiteEventsParserError(
      "invalid_assumeYear",
      "assumeYear must be between 2000 and 2100.",
    );
  }

  return year;
}

function sanitizeErrorMessage(value) {
  return shortText(String(value).replace(/\s+/g, " "), 300) ??
    "Parser error.";
}
