import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../services/apiClient";
import {
  checkAdminEventPublicSlug,
  getAdminEventWebRegistration,
  updateAdminEventWebRegistration,
} from "../../services/adminEventsService";
import type {
  AdminEventPublicSlugCheckResult,
  AdminEventWebRegistration,
  AdminEventWebVisibilityUpdate,
} from "../../types/events";

export type CopyFeedback = {
  kind: "success" | "error";
  message: string;
};

export type SlugCheckState =
  | { kind: "idle" }
  | { kind: "checking"; key: string }
  | { kind: "available"; key: string; normalizedSlug: string }
  | { kind: "taken"; key: string; normalizedSlug: string }
  | { kind: "invalid"; key: string }
  | { kind: "error"; key: string };

export type TrustedPublicUrl = {
  prefix: string;
};

const SLUG_CHECK_DEBOUNCE_MS = 400;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function slugCheckValue(suffix: string, eventTitle: string): string {
  return suffix.trim() === "" ? eventTitle : suffix;
}

function slugCheckKey(suffix: string, eventTitle: string): string {
  return JSON.stringify([suffix, slugCheckValue(suffix, eventTitle)]);
}

export function trustedPublicUrl(
  publicSlug: string,
  publicRegistrationUrl: string,
): TrustedPublicUrl | null {
  try {
    const parsed = new URL(publicRegistrationUrl);
    const suffixPath = `/events/${publicSlug}`;

    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || !parsed.pathname.endsWith(suffixPath)
    ) {
      return null;
    }

    return {
      prefix: `${parsed.origin}${parsed.pathname.slice(0, -publicSlug.length)}`,
    };
  } catch {
    return null;
  }
}

export function useEventWebRegistrationEditor(eventId: string, eventTitle: string) {
  const [registration, setRegistration] = useState<AdminEventWebRegistration | null>(null);
  const [slugSuffix, setSlugSuffix] = useState("");
  const [slugCheck, setSlugCheck] = useState<SlugCheckState>({ kind: "idle" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilitySaveError, setVisibilitySaveError] = useState<string | null>(null);
  const [visibilitySavedAt, setVisibilitySavedAt] = useState<string | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugSaveError, setSlugSaveError] = useState<string | null>(null);
  const [slugSavedAt, setSlugSavedAt] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [headerEditing, setHeaderEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slugAbortRef = useRef<AbortController | null>(null);
  const slugRequestSequenceRef = useRef(0);
  const mountedRef = useRef(false);

  const cancelSlugWork = useCallback(() => {
    if (slugDebounceRef.current !== null) {
      clearTimeout(slugDebounceRef.current);
      slugDebounceRef.current = null;
    }
    slugAbortRef.current?.abort();
    slugAbortRef.current = null;
    slugRequestSequenceRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelSlugWork();
    };
  }, [cancelSlugWork]);

  const performSlugCheck = useCallback(async (suffix: string, title: string) => {
    cancelSlugWork();
    const key = slugCheckKey(suffix, title);
    const controller = new AbortController();
    const requestSequence = slugRequestSequenceRef.current;
    slugAbortRef.current = controller;
    setSlugCheck({ kind: "checking", key });

    try {
      const result: AdminEventPublicSlugCheckResult = await checkAdminEventPublicSlug(
        eventId,
        slugCheckValue(suffix, title),
        controller.signal,
      );
      if (!mountedRef.current || requestSequence !== slugRequestSequenceRef.current) return;
      setSlugCheck(
        result.available
          ? { kind: "available", key, normalizedSlug: result.normalizedSlug }
          : { kind: "taken", key, normalizedSlug: result.normalizedSlug },
      );
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || requestSequence !== slugRequestSequenceRef.current) return;
      setSlugCheck(
        error instanceof ApiClientError && error.code === "invalid_public_slug"
          ? { kind: "invalid", key }
          : { kind: "error", key },
      );
    } finally {
      if (slugAbortRef.current === controller) slugAbortRef.current = null;
    }
  }, [cancelSlugWork, eventId]);

  const scheduleSlugCheck = useCallback((suffix: string, title: string) => {
    cancelSlugWork();
    setSlugCheck({ kind: "checking", key: slugCheckKey(suffix, title) });
    slugDebounceRef.current = setTimeout(() => {
      slugDebounceRef.current = null;
      void performSlugCheck(suffix, title);
    }, SLUG_CHECK_DEBOUNCE_MS);
  }, [cancelSlugWork, performSlugCheck]);

  useEffect(() => {
    let active = true;
    cancelSlugWork();
    setRegistration(null);
    setLoading(true);
    setLoadError(null);
    setVisibilitySaving(false);
    setVisibilitySaveError(null);
    setVisibilitySavedAt(null);
    setSlugSaving(false);
    setSlugSaveError(null);
    setSlugSavedAt(null);
    setSlugCheck({ kind: "idle" });
    setCopyFeedback(null);
    setHeaderEditing(false);

    void getAdminEventWebRegistration(eventId)
      .then((nextRegistration) => {
        if (!active) return;
        setRegistration(nextRegistration);
        setSlugSuffix(nextRegistration.publicSlug);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error, "Не удалось загрузить настройки веб-регистрации."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [cancelSlugWork, eventId, refreshKey]);

  const publicUrl = useMemo(
    () => registration ? trustedPublicUrl(registration.publicSlug, registration.publicRegistrationUrl) : null,
    [registration],
  );
  const currentSlugKey = slugCheckKey(slugSuffix, eventTitle);
  const checkedSlug = slugCheck.kind === "available" && slugCheck.key === currentSlugKey
    ? slugCheck.normalizedSlug
    : null;
  const slugStatus = slugCheck.kind !== "idle" && slugCheck.key === currentSlugKey
    ? slugCheck.kind
    : "idle";
  const canSaveSlug = Boolean(registration && publicUrl && checkedSlug && checkedSlug !== registration.publicSlug && !slugSaving);
  const dirty = Boolean(registration && slugSuffix !== registration.publicSlug);

  const changeSlug = useCallback((suffix: string) => {
    setSlugSuffix(suffix);
    setSlugSaveError(null);
    setSlugSavedAt(null);
    if (publicUrl) scheduleSlugCheck(suffix, eventTitle);
  }, [eventTitle, publicUrl, scheduleSlugCheck]);

  const checkSlugNow = useCallback(() => {
    const hasCurrentTerminalResult = slugCheck.kind !== "idle"
      && slugCheck.key === currentSlugKey
      && (slugCheck.kind === "available" || slugCheck.kind === "taken" || slugCheck.kind === "invalid");
    if (publicUrl && !hasCurrentTerminalResult) void performSlugCheck(slugSuffix, eventTitle);
  }, [currentSlugKey, eventTitle, performSlugCheck, publicUrl, slugCheck, slugSuffix]);

  const saveSlug = useCallback(async (): Promise<boolean> => {
    if (!registration || !checkedSlug || !canSaveSlug) return false;
    setSlugSaving(true);
    setSlugSaveError(null);
    setSlugSavedAt(null);
    try {
      const nextRegistration = await updateAdminEventWebRegistration(eventId, { publicSlug: checkedSlug });
      cancelSlugWork();
      setRegistration(nextRegistration);
      setSlugSuffix(nextRegistration.publicSlug);
      setSlugCheck({ kind: "idle" });
      setSlugSavedAt(new Date().toISOString());
      setCopyFeedback(null);
      setHeaderEditing(false);
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 409 || error.code === "public_slug_taken")) {
        setSlugCheck({ kind: "taken", key: currentSlugKey, normalizedSlug: checkedSlug });
        setSlugSaveError("Адрес уже занят");
      } else if (error instanceof ApiClientError && error.code === "invalid_public_slug") {
        setSlugCheck({ kind: "invalid", key: currentSlugKey });
        setSlugSaveError("Недопустимый формат");
      } else {
        setSlugSaveError("Не удалось сохранить адрес страницы. Попробуйте ещё раз.");
      }
      return false;
    } finally {
      setSlugSaving(false);
    }
  }, [canSaveSlug, cancelSlugWork, checkedSlug, currentSlugKey, eventId, registration]);

  const changeVisibility = useCallback(async (webVisibility: AdminEventWebVisibilityUpdate): Promise<boolean> => {
    if (!registration || registration.webVisibility === "listed" || visibilitySaving) return false;
    setVisibilitySaving(true);
    setVisibilitySaveError(null);
    setVisibilitySavedAt(null);
    try {
      const nextRegistration = await updateAdminEventWebRegistration(eventId, { webVisibility });
      setRegistration(nextRegistration);
      setVisibilitySavedAt(new Date().toISOString());
      return true;
    } catch (error) {
      setVisibilitySaveError(errorMessage(error, "Не удалось сохранить режим веб-регистрации."));
      return false;
    } finally {
      setVisibilitySaving(false);
    }
  }, [eventId, registration, visibilitySaving]);

  const copyCanonicalUrl = useCallback(async () => {
    if (!registration) return;
    setCopyFeedback(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(registration.publicRegistrationUrl);
      setCopyFeedback({
        kind: "success",
        message: registration.webVisibility === "disabled"
          ? "Ссылка скопирована. Страница сейчас отключена и недоступна участникам."
          : "Ссылка скопирована",
      });
    } catch {
      setCopyFeedback({ kind: "error", message: "Не удалось скопировать ссылку. Скопируйте показанный адрес вручную." });
    }
  }, [registration]);

  const cancelSlugEdit = useCallback(() => {
    if (registration) setSlugSuffix(registration.publicSlug);
    cancelSlugWork();
    setSlugCheck({ kind: "idle" });
    setSlugSaveError(null);
    setSlugSavedAt(null);
    setHeaderEditing(false);
  }, [cancelSlugWork, registration]);

  return {
    registration, loading, loadError, dirty, publicUrl, slugSuffix, slugCheck, slugStatus,
    slugSaveError, slugSavedAt, slugSaving, visibilitySaving, visibilitySaveError,
    visibilitySavedAt, copyFeedback, headerEditing, canSaveSlug,
    refresh: () => setRefreshKey((key) => key + 1),
    changeSlug, checkSlugNow, saveSlug, cancelSlugEdit,
    startHeaderEdit: () => setHeaderEditing(true),
    changeVisibility, copyCanonicalUrl,
  };
}
