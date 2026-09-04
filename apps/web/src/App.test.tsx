import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  EVENT_ID,
  OCCURRENCE_ONE_ID,
  OCCURRENCE_TWO_ID,
  OPTION_ID,
  PUBLIC_SLUG,
  QUESTIONNAIRE_FORM_ID,
  QUESTION_IDS,
  eventResponse,
  myRegistration,
  responseWithOccurrences,
  responseWithPaidOptions,
  responseWithQuestionnaire,
} from "./test/fixtures";

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

const FLOW_ID = "opaque-flow-credential";
const REGISTRATION_ID = "77777777-7777-4777-8777-777777777777";
const PRIVACY_REQUEST_ID = "88888888-8888-4888-8888-888888888888";
const EXPIRES_AT = "2026-09-12T18:00:00+03:00";
const SET_PASSWORD_CODE = "opaque-set-password-code-with-sufficient-length";

// jsdom has no native dialog top layer; model open/close for component tests.
const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalDialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
function dispatchNativeDialogCancel(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // Native Escape cancellation also works when focus leaves a newly disabled control.
  const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1);
  if (dialog?.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
}
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  document.addEventListener("keydown", dispatchNativeDialogCancel);
});
afterAll(() => {
  document.removeEventListener("keydown", dispatchNativeDialogCancel);
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalDialogClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

afterEach(() => vi.useRealTimers());

function envelope<T>(data: T) {
  return { data, error: null, meta: {} };
}

function intentCreated(nextStep: "confirm_email" | "completed" = "confirm_email") {
  return envelope({ flow_id: FLOW_ID, next_step: nextStep, expires_at: EXPIRES_AT });
}

function registrationResult(
  status: "confirmed" | "pending" | "waitlisted" = "confirmed",
  accountNextStep: "none" | "set_password" | "sign_in" | "request_set_password" = "none",
  occurrenceId: string | null = null,
  paymentStatus: "not_required" | "pending" = "not_required",
  totalAmount: number | null = 0,
  totalCurrency: string | null = "RUB",
) {
  return envelope({
    intent_status: "confirmed",
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT_ID,
      occurrence_id: occurrenceId,
      status,
      seats_count: 1,
      payment_status: paymentStatus,
      total_amount: totalAmount,
      total_currency: totalCurrency,
    },
    account_next_step: accountNextStep,
    set_password_code: accountNextStep === "set_password" ? SET_PASSWORD_CODE : null,
    set_password_expires_at: accountNextStep === "set_password" ? EXPIRES_AT : null,
  });
}

function privacySession() {
  return envelope({
    privacy_session_token: "privacy-session-token",
    token_type: "bearer",
    scope: "privacy_self_service",
    expires_at: EXPIRES_AT,
  });
}

function deletionPrivacyRequest() {
  return envelope({
    id: PRIVACY_REQUEST_ID,
    community_id: "00000000-0000-0000-0000-000000000001",
    request_type: "deletion",
    message: null,
    status: "open",
    resolution_note: null,
    resolved_at: null,
    created_at: EXPIRES_AT,
    updated_at: EXPIRES_AT,
  });
}

function deletionPendingLifecycle() {
  return envelope({
    request_id: PRIVACY_REQUEST_ID,
    state: "deletion_pending",
    processing_stopped_at: EXPIRES_AT,
    cancelled_at: null,
    registrations_require_reregistration_after_cancel: true,
  });
}

function apiError(code: string, message = "hidden backend detail") {
  return { data: null, error: { code, message }, meta: {} };
}

function successfulFetch(data = eventResponse()) {
  vi.mocked(fetch).mockImplementation(() => response({ data, error: null, meta: {} }));
}

function paidEventResponse() {
  const data = responseWithPaidOptions();
  data.event.registration_mode = "internal_paid";
  return data;
}

function recurringOpenEvent() {
  const data = responseWithOccurrences();
  data.registration_state = "open";
  data.occurrences = data.occurrences.map((occurrence) => ({
    ...occurrence,
    registration_state: "open",
  }));
  return data;
}

async function renderEvent(data = eventResponse(), search = "", pathValue = EVENT_ID) {
  successfulFetch(data);
  window.history.replaceState(null, "", `/events/${pathValue}${search}`);
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: data.event.title });
}

function optionCard(title: string): HTMLElement {
  const card = screen.getByText(title, { selector: "strong" }).closest(".option-card");
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  { consent = true }: { consent?: boolean } = {},
) {
  await user.type(screen.getByLabelText("Имя"), "  Анна   Мария  ");
  await user.type(screen.getByLabelText("Фамилия"), "Иванова");
  await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
  await user.type(screen.getByLabelText("Email"), "anna@example.ru");
  await user.click(screen.getByRole("checkbox", { name: /Основное участие/ }));
  if (consent) await user.click(screen.getByLabelText(/Я ознакомился/));
}

async function fillValidQuestionnaire(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Код встречи/), " ok ");
  await user.type(screen.getByLabelText(/Комментарий по прибытию/), "Обычный комментарий");
  await user.click(screen.getByRole("radio", { name: "Северный" }));
  await user.click(screen.getByRole("checkbox", { name: "Первая" }));
  await user.click(screen.getByRole("radio", { name: "Нет" }));
}

async function createIntent(
  user: ReturnType<typeof userEvent.setup>,
  choice: "Записаться на мероприятие" | "Создать аккаунт" = "Записаться на мероприятие",
) {
  vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
  if (choice === "Создать аккаунт") await user.click(screen.getByText("Что происходит с моими данными"));
  await user.click(screen.getByRole("button", { name: choice }));
  await screen.findByRole("heading", { name: "Введите код из письма" });
}

async function confirmIntent(
  user: ReturnType<typeof userEvent.setup>,
  result = registrationResult(),
) {
  vi.mocked(fetch).mockImplementationOnce(() => response(result));
  await user.type(screen.getByLabelText("Код подтверждения"), "123456");
  await user.click(screen.getByRole("button", { name: "Подтвердить email" }));
}

async function signInExistingAccount(
  user: ReturnType<typeof userEvent.setup>,
  accessToken = "temporary-access-token",
) {
  vi.mocked(fetch)
    .mockImplementationOnce(() => response({
      access_token: accessToken,
      refresh_token: "temporary-refresh-token",
      token_type: "bearer",
      expires_at: EXPIRES_AT,
      user: {},
    }))
    .mockImplementationOnce(() => response({
      user: { email: "ivan@example.ru", email_verified_at: EXPIRES_AT },
      profile: { first_name: "Иван", last_name: "Иванов", phone: "+79000000001" },
      memberships: [],
    }));
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
  await user.type(screen.getByLabelText("Email", { selector: "#login-email" }), "ivan@example.ru");
  await user.type(screen.getByLabelText("Пароль"), "secret-password");
  await user.click(within(screen.getByRole("dialog", { name: "Войти в аккаунт" })).getByRole("button", { name: "Войти" }));
  return screen.findByRole("region", { name: "Аккаунт" });
}

async function openSignedInDeletion(user: ReturnType<typeof userEvent.setup>) {
  const accountPanel = await signInExistingAccount(user, "normal-account-access-token");
  await user.click(within(accountPanel).getByRole("button", { name: "Управление аккаунтом" }));
  await user.click(within(accountPanel).getByRole("button", { name: "Удалить аккаунт" }));
  return screen.findByRole("dialog", { name: "Удаление аккаунта и данных" });
}

describe("public event page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders not found and makes no request for malformed and unknown routes", () => {
    for (const path of ["/events/Shabbat", "/events/Шабат", "/events/bad--slug", "/events/shabbat/extra", "/events", "/login"]) {
      window.history.replaceState(null, "", path);
      const { unmount } = render(<App />);
      expect(screen.getByRole("heading", { level: 1, name: "Страница не найдена" })).toBeInTheDocument();
      unmount();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows an accessible loading state before the response arrives", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => undefined));
    window.history.replaceState(null, "", `/events/${EVENT_ID}`);
    render(<App />);
    expect(screen.getByText("Загружаем мероприятие")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("renders a successful public event response and updates the title", async () => {
    await renderEvent();
    expect(screen.getByText("Тёплая встреча общины")).toBeInTheDocument();
    expect(screen.getByText("Общинный центр, Москва")).toBeInTheDocument();
    expect(screen.getByText(/Полное описание/)).toHaveClass("description");
    expect(document.title).toBe("Шаббат для друзей — Среди Своих");
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
  });

  it("keeps an already canonical slug path without replaceState", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    await renderEvent(eventResponse(), "", PUBLIC_SLUG);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("preserves registration jumps, sticky visibility and description expansion (motion allowed: %s)", async (motionAllowed) => {
    const user = userEvent.setup();
    const originalWindowProperties = ["innerWidth", "scrollY", "matchMedia"].map((name) => (
      [name, Object.getOwnPropertyDescriptor(window, name)] as const
    ));
    Object.defineProperties(window, {
      innerWidth: { configurable: true, value: 390 },
      scrollY: { configurable: true, value: 300 },
      matchMedia: { configurable: true, value: vi.fn().mockReturnValue({ matches: motionAllowed }) },
    });
    // Layout and scrolling are unavailable in jsdom; exercise the page's handlers.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const scrollIntoView = vi.fn();
    const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      await renderEvent();
      const column = document.querySelector(".form-column") as HTMLElement;
      const bounds = vi.spyOn(column, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight + 100 } as DOMRect);
      fireEvent.resize(window);
      act(() => frames.shift()?.(0));
      const sticky = screen.getByRole("button", { name: "К регистрации" });
      expect(sticky).toHaveClass("primary-button");
      await user.click(sticky);
      expect(column).toHaveFocus();
      expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: motionAllowed ? "smooth" : "auto", block: "start" });
      await user.click(screen.getByRole("button", { name: /Перейти к регистрации/ }));
      expect(column).toHaveFocus();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      bounds.mockReturnValue({ top: 100 } as DOMRect);
      fireEvent.resize(window);
      act(() => frames.shift()?.(0));
      expect(screen.queryByRole("button", { name: "К регистрации" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Читать полностью/ }));
      expect(screen.getByRole("button", { name: /Свернуть/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(/Полное описание/)).toHaveClass("expanded");
      expect(screen.getByText("Тёплая встреча общины")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Свернуть/ }));
      expect(screen.getByRole("button", { name: /Читать полностью/ })).toHaveAttribute("aria-expanded", "false");
    } finally {
      HTMLElement.prototype.scrollIntoView = previousScrollIntoView;
      for (const [name, descriptor] of originalWindowProperties) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else Reflect.deleteProperty(window, name);
      }
    }
  });

  it("replaces an alias with the canonical path without a second fetch", async () => {
    const data = eventResponse();
    data.resolved_from_alias = true;
    await renderEvent(data, "", "staryy-adres");
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("replaces a legacy UUID with the canonical path without a second fetch", async () => {
    await renderEvent();
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`/events/${EVENT_ID}/registration-form?channel=web`);
  });

  it("uses the slug endpoint and keeps the same neutral unavailable state", async () => {
    vi.mocked(fetch).mockImplementation(() => response({ detail: "hidden" }, 404));
    window.history.replaceState(null, "", "/events/unknown-event");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Страница мероприятия недоступна" })).toBeInTheDocument();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("/api/web/events/unknown-event/registration-form");
    expect(document.body).not.toHaveTextContent("hidden");
  });

  it("uses a branded image fallback when an event image is missing or broken", async () => {
    await renderEvent();
    fireEvent.error(screen.getByRole("img", { name: /Мероприятие/ }));
    expect(screen.getByRole("img", { name: /Изображение мероприятия/ })).toBeInTheDocument();
  });

  it("uses the same branded image fallback when the image URL is absent", async () => {
    const data = eventResponse();
    data.event.image_url = null;
    await renderEvent(data);
    expect(screen.getByRole("img", { name: /Изображение мероприятия/ })).toBeInTheDocument();
  });

  it("renders the same neutral unavailable page for a 404", async () => {
    vi.mocked(fetch).mockImplementation(() => response({}, 404));
    window.history.replaceState(null, "", `/events/${EVENT_ID}`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Страница мероприятия недоступна" })).toBeInTheDocument();
    expect(screen.getByText(/регистрация ещё не открыта/)).toBeInTheDocument();
  });

  it("offers one-request retry after network and server errors", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => response({ data: eventResponse(), error: null, meta: {} }));
    window.history.replaceState(null, "", `/events/${EVENT_ID}`);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Попробовать снова" }));
    expect(await screen.findByRole("heading", { name: "Шаббат для друзей" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("handles malformed successful JSON as a generic application error", async () => {
    vi.mocked(fetch).mockImplementation(() => response({ data: { event: { id: EVENT_ID } } }));
    window.history.replaceState(null, "", `/events/${EVENT_ID}`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Не удалось загрузить мероприятие" })).toBeInTheDocument();
  });

  it.each(["event_registration_consent", "privacy_policy"] as const)(
    "shows the generic application error for an unsafe %s URL",
    async (documentType) => {
      const data = eventResponse();
      const legalDocument = data.legal_documents.find((document) => document.document_type === documentType);
      if (!legalDocument) throw new Error(`Missing ${documentType} fixture`);
      legalDocument.published_url = "javascript:alert(1)";
      successfulFetch(data);
      window.history.replaceState(null, "", `/events/${EVENT_ID}`);
      render(<App />);
      expect(await screen.findByRole("heading", { name: "Не удалось загрузить мероприятие" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: legalDocument.title })).not.toBeInTheDocument();
    },
  );

  it("does not activate an unsafe optional image URL and uses the branded fallback", async () => {
    const data = eventResponse();
    data.event.image_url = "data:image/svg+xml,<svg onload='alert(1)'/>";
    await renderEvent(data);
    expect(screen.getByRole("img", { name: /Изображение мероприятия/ })).toBeInTheDocument();
    expect(document.querySelector(`img[src^="data:"]`)).toBeNull();
  });

  it("does not render unexpected admin or participant properties", async () => {
    const data = eventResponse() as unknown as Record<string, unknown>;
    data.admin_notes = "PRIVATE ADMIN VALUE";
    data.registrations = [{ email: "participant@example.test" }];
    await renderEvent(data as unknown as ReturnType<typeof eventResponse>);
    expect(screen.queryByText("PRIVATE ADMIN VALUE")).not.toBeInTheDocument();
    expect(screen.queryByText("participant@example.test")).not.toBeInTheDocument();
  });
});

describe("registration state and occurrences", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("renders personal fields only for an open event", async () => {
    await renderEvent(eventResponse("open"));
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it.each([
    ["not_yet_open", "Регистрация ещё не открыта"],
    ["closed", "Регистрация закрыта"],
    ["full", "Мест нет"],
  ] as const)("keeps a %s event visible without PII fields", async (state, label) => {
    await renderEvent(eventResponse(state));
    expect(screen.getByRole("heading", { name: "Шаббат для друзей" })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
  });

  it("requires Continue after date selection and hides the complete free flow until then", async () => {
    const user = userEvent.setup();
    const data = responseWithQuestionnaire();
    const occurrenceData = recurringOpenEvent();
    data.registration_state = occurrenceData.registration_state;
    data.occurrence_selection_mode = "user_select";
    data.default_occurrence_id = null;
    data.occurrences = occurrenceData.occurrences;
    data.participation_options = [];
    await renderEvent(data);

    expect(
      screen.getAllByRole<HTMLInputElement>("radio", { name: /Пятница|Суббота/ })
        .every((radio) => !radio.checked),
    ).toBe(true);
    expect(screen.getByText("Шаг 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Выберите дату" })).toBeInTheDocument();
    expect(screen.getByText("Сначала выберите дату участия, затем перейдите к регистрации.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Варианты участия" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Количество мест" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Дополнительные вопросы" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Я ознакомился/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Пятница/ }));
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Количество мест" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByRole("heading", { name: "Регистрация" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Количество мест" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Дополнительные вопросы" })).toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("preselects a valid query occurrence but still requires explicit Continue", async () => {
    const user = userEvent.setup();
    await renderEvent(recurringOpenEvent(), `?occurrence=${OCCURRENCE_TWO_ID}`);
    expect(screen.getByRole("radio", { name: /Суббота/ })).toBeChecked();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(window.location.search).toBe(`?occurrence=${OCCURRENCE_TWO_ID}`);
  });

  it("ignores an occurrence outside the returned list", async () => {
    await renderEvent(recurringOpenEvent(), "?occurrence=77777777-7777-4777-8777-777777777777");
    expect(screen.getByRole("radio", { name: /Пятница/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Суббота/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeDisabled();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("removes an invalid occurrence query from the canonical URL", async () => {
    await renderEvent(responseWithOccurrences(), "?occurrence=not-a-uuid&source=invite");
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(window.location.search).toBe("");
  });

  it("keeps manual date selection out of the canonical URL", async () => {
    const user = userEvent.setup();
    await renderEvent(recurringOpenEvent(), "?source=invite");
    await user.click(screen.getByRole("radio", { name: /Суббота/ }));
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(window.location.search).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns to date selection, clears in-progress form state, and submits the new occurrence", async () => {
    const user = userEvent.setup();
    const data = recurringOpenEvent();
    data.participation_options = [];
    await renderEvent(data);
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Пятница/ }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Имя"), "Старое значение");
    await user.click(screen.getByRole("button", { name: "Изменить дату" }));
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Суббота/ }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByLabelText("Имя")).toHaveValue("");

    await user.type(screen.getByLabelText("Имя"), "Анна");
    await user.type(screen.getByLabelText("Фамилия"), "Иванова");
    await user.type(screen.getByLabelText("Телефон"), "+44 7400 123456");
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    await user.click(screen.getByLabelText(/Я ознакомился/));
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(body.occurrence_id).toBe(OCCURRENCE_TWO_ID);
    expect(body.phone).toBe("+447400123456");
  });

  it("hides paid participation options until the date step is complete", async () => {
    const user = userEvent.setup();
    const data = recurringOpenEvent();
    const paid = paidEventResponse();
    data.event.registration_mode = "internal_paid";
    data.participation_options = paid.participation_options;
    await renderEvent(data);

    expect(screen.queryByRole("group", { name: "Варианты участия" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Пятница/ }));
    expect(screen.queryByRole("group", { name: "Варианты участия" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toBeInTheDocument();
  });

  it("does not preselect or continue to a closed query occurrence", async () => {
    const data = recurringOpenEvent();
    const closedId = "99999999-9999-4999-8999-999999999999";
    data.occurrences.push({ ...data.occurrences[0], id: closedId, title: "Закрытая дата", registration_state: "closed" });
    await renderEvent(data, `?occurrence=${closedId}`);

    expect(screen.getByRole("button", { name: "Продолжить" })).toBeDisabled();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Закрытая дата/ })).not.toBeInTheDocument();
  });

  it("uses the backend nearest occurrence without rendering a selector or honoring query", async () => {
    const data = responseWithOccurrences();
    data.occurrence_selection_mode = "nearest";
    data.default_occurrence_id = OCCURRENCE_TWO_ID;
    data.registration_state = "open";
    await renderEvent(data, `?occurrence=${OCCURRENCE_ONE_ID}`);

    expect(screen.queryByRole("radio", { name: /Пятница|Суббота/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Выберите дату")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("automatically uses one occurrence without rendering a selector", async () => {
    const data = responseWithOccurrences();
    data.occurrences = [data.occurrences[1]];
    data.occurrence_selection_mode = "none";
    data.default_occurrence_id = OCCURRENCE_TWO_ID;
    data.registration_state = "open";
    await renderEvent(data);

    expect(screen.queryByRole("radio", { name: /Суббота/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Выберите дату")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("uses the only open user-select occurrence without a redundant date step", async () => {
    const data = responseWithOccurrences();
    await renderEvent(data);

    expect(screen.queryByRole("heading", { name: "Выберите дату" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Продолжить" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("refetches at the backend timestamp without changing state before the response", async () => {
    vi.useFakeTimers();
    const browserNow = new Date("2026-08-11T10:00:00Z");
    vi.setSystemTime(browserNow);
    const beforeOpening = eventResponse("not_yet_open");
    beforeOpening.next_registration_state_check_at = new Date(
      browserNow.getTime() + 1_000,
    ).toISOString();
    const opened = eventResponse("open");
    let resolveRefresh!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope(beforeOpening)))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    window.history.replaceState(null, "", `/events/${PUBLIC_SLUG}`);
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Регистрация ещё не открыта")).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Регистрация ещё не открыта")).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();

    const refreshedResponse = await response(envelope(opened));
    await act(async () => {
      resolveRefresh(refreshedResponse);
      await Promise.resolve();
    });
    expect(screen.getByText("Регистрация открыта")).toBeInTheDocument();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("refetches server state when the document becomes visible", async () => {
    const beforeOpening = eventResponse("not_yet_open");
    const opened = eventResponse("open");
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope(beforeOpening)))
      .mockImplementationOnce(() => response(envelope(opened)));
    window.history.replaceState(null, "", `/events/${PUBLIC_SLUG}`);
    render(<App />);
    expect(await screen.findByText("Регистрация ещё не открыта")).toBeInTheDocument();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Регистрация открыта")).toBeInTheDocument();
  });
});

describe("participation option presentation", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("shows the canonical participation type chip without emphasizing a zero price", async () => {
    await renderEvent();
    const card = optionCard("Основное участие");
    expect(within(card).getByText("Участие", { selector: ".option-type-chip" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/0\s*₽/);
  });

  it.each([
    ["Общая трапеза", "Трапеза"],
    ["Пакет выходного дня", "Пакет"],
    ["Детское участие", "Детский"],
    ["Семейное участие", "Семейный"],
    ["Онлайн-подключение", "Другое"],
    ["Пожертвование общине", "Пожертвование"],
  ])("maps %s to the %s type chip", async (title, label) => {
    await renderEvent(responseWithPaidOptions());
    expect(within(optionCard(title)).getByText(label, { selector: ".option-type-chip" })).toBeInTheDocument();
  });

  it("renders a positive backend-provided price with locale-aware currency formatting", async () => {
    await renderEvent(responseWithPaidOptions());
    expect(optionCard("Платное участие").querySelector(".option-price"))
      .toHaveTextContent(/1.?500,00.?₽/);
  });

  it("places donation options in their own section and lets is_donation override option_type", async () => {
    await renderEvent(responseWithPaidOptions());
    const donationSection = screen.getByRole("region", { name: "Дополнительно / Пожертвование" });
    expect(within(donationSection).getByText("Пожертвование общине")).toBeInTheDocument();
    const overrideCard = within(donationSection).getByText("Поддержать детскую программу").closest(".option-card");
    expect(overrideCard).not.toBeNull();
    expect(within(overrideCard as HTMLElement).getByText("Участие", { selector: ".option-type-chip" })).toBeInTheDocument();
    expect(within(donationSection).queryByText("Платное участие")).not.toBeInTheDocument();
  });

  it("shows non-capacity semantics for a non-donation option", async () => {
    await renderEvent(responseWithPaidOptions());
    expect(within(optionCard("Онлайн-подключение")).getByText("Не занимает место")).toBeInTheDocument();
  });

  it("requires a capacity-counting main option even when a non-donation non-capacity option is selected", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithPaidOptions());
    const onlineOption = screen.getByRole("checkbox", { name: /Онлайн-подключение/ });
    await user.click(onlineOption);
    expect(onlineOption).toBeChecked();
    expect(within(optionCard("Онлайн-подключение")).getByText("Не занимает место")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Имя"), "Анна");
    await user.type(screen.getByLabelText("Фамилия"), "Иванова");
    await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    await user.click(screen.getByLabelText(/Я ознакомился/));
    const continueButton = screen.getByRole("button", { name: "Записаться на мероприятие" });
    await user.click(continueButton);

    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByText("Выберите вариант участия.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(continueButton);
    expect(await screen.findByLabelText("Код подтверждения")).toHaveFocus();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("increments and decrements quantity through accessible stepper buttons", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithPaidOptions());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const quantity = screen.getByLabelText("Количество: Платное участие");
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Платное участие" }));
    expect(quantity).toHaveTextContent("3");
    await user.click(screen.getByRole("button", { name: "Уменьшить количество: Платное участие" }));
    expect(quantity).toHaveTextContent("2");
  });

  it("cannot increment beyond max_quantity", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithPaidOptions());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const increment = screen.getByRole("button", { name: "Увеличить количество: Платное участие" });
    await user.click(increment);
    await user.click(increment);
    expect(screen.getByLabelText("Количество: Платное участие")).toHaveTextContent("4");
    expect(increment).toBeDisabled();
    await user.click(increment);
    expect(screen.getByLabelText("Количество: Платное участие")).toHaveTextContent("4");
  });

  it("cannot decrement below min_quantity", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithPaidOptions());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const decrement = screen.getByRole("button", { name: "Уменьшить количество: Платное участие" });
    expect(decrement).toBeDisabled();
    await user.click(decrement);
    expect(screen.getByLabelText("Количество: Платное участие")).toHaveTextContent("2");
  });

  it("does not expose quantity controls when allow_quantity is false", async () => {
    await renderEvent();
    expect(screen.queryByRole("button", { name: /количество: Основное участие/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Количество: Основное участие")).not.toBeInTheDocument();
  });

  it("preserves radio behavior for options sharing a group_key", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithPaidOptions());
    const paid = screen.getByRole("radio", { name: /Платное участие/ });
    const family = screen.getByRole("radio", { name: /Семейное участие/ });
    await user.click(paid);
    expect(paid).toBeChecked();
    await user.click(family);
    expect(family).toBeChecked();
    expect(paid).not.toBeChecked();
  });

  it("keeps the ordinary free option as a simple selectable option", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const option = screen.getByRole("checkbox", { name: /Основное участие/ });
    expect(screen.queryByRole("region", { name: "Дополнительно / Пожертвование" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Оплатить|Оплачено|Оплата прошла/)).not.toBeInTheDocument();
    await user.click(option);
    expect(option).toBeChecked();
  });
});

describe("paid registration display totals", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("shows a neutral paid summary and recomputes amount and seats with quantity", async () => {
    const user = userEvent.setup();
    await renderEvent(paidEventResponse());
    expect(screen.queryByRole("region", { name: "Итог регистрации" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const summary = screen.getByRole("region", { name: "Итог регистрации" });
    expect(summary).toHaveTextContent(/Итого:\s*3.?000.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*2/);

    await user.click(screen.getByRole("button", { name: "Увеличить количество: Платное участие" }));
    expect(summary).toHaveTextContent(/Итого:\s*4.?500.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*3/);
    expect(screen.queryByText(/К оплате|Оплатить|Оплачено|Оплата прошла/)).not.toBeInTheDocument();
  });

  it("changes only amount for donations and priced non-capacity options, including deselection", async () => {
    const data = paidEventResponse();
    const online = data.participation_options.find((option) => option.title === "Онлайн-подключение");
    expect(online).toBeDefined();
    if (online) online.price_amount = 500;
    const user = userEvent.setup();
    await renderEvent(data);
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const summary = screen.getByRole("region", { name: "Итог регистрации" });

    const donation = screen.getByRole("checkbox", { name: /Пожертвование общине/ });
    await user.click(donation);
    expect(summary).toHaveTextContent(/Итого:\s*4.?000.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*2/);

    const nonCapacity = screen.getByRole("checkbox", { name: /Онлайн-подключение/ });
    await user.click(nonCapacity);
    expect(summary).toHaveTextContent(/Итого:\s*4.?500.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*2/);

    await user.click(nonCapacity);
    expect(summary).toHaveTextContent(/Итого:\s*4.?000.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*2/);
    await user.click(donation);
    expect(summary).toHaveTextContent(/Итого:\s*3.?000.?₽/);
  });

  it("recomputes totals when a radio group changes", async () => {
    const user = userEvent.setup();
    await renderEvent(paidEventResponse());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const summary = screen.getByRole("region", { name: "Итог регистрации" });
    expect(summary).toHaveTextContent(/Итого:\s*3.?000.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*2/);

    await user.click(screen.getByRole("radio", { name: /Семейное участие/ }));
    expect(summary).toHaveTextContent(/Итого:\s*3.?500.?₽/);
    expect(summary).toHaveTextContent(/Мест:\s*1/);
  });

  it("shows a mixed-currency error, blocks submit, and recovers without discarding selection", async () => {
    const data = paidEventResponse();
    const donation = data.participation_options.find((option) => option.title === "Пожертвование общине");
    expect(donation).toBeDefined();
    if (donation) donation.price_currency = "USD";
    const user = userEvent.setup();
    await renderEvent(data);
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    const donationInput = screen.getByRole("checkbox", { name: /Пожертвование общине/ });
    await user.click(donationInput);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Выбранные варианты используют разные валюты. Измените выбор вариантов участия.",
    );
    expect(screen.queryByRole("region", { name: "Итог регистрации" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Имя"), "Анна");
    await user.type(screen.getByLabelText("Фамилия"), "Иванова");
    await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    await user.click(screen.getByLabelText(/Я ознакомился/));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(donationInput).toBeChecked();

    await user.click(donationInput);
    expect(screen.queryByText("Выбранные варианты используют разные валюты. Измените выбор вариантов участия."))
      .not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Итог регистрации" })).toHaveTextContent(/Итого:\s*3.?000.?₽/);
  });

  it("sends calculated paid-option seats and canonical selection identity only", async () => {
    const user = userEvent.setup();
    await renderEvent(paidEventResponse());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Платное участие" }));
    expect(screen.queryByRole("spinbutton", { name: "Количество мест" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Имя"), "Анна");
    await user.type(screen.getByLabelText("Фамилия"), "Иванова");
    await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    await user.click(screen.getByLabelText(/Я ознакомился/));
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(body.seats_count).toBe(3);
    expect(body.option_selections).toEqual([{
      option_id: "44444444-4444-4444-8444-444444444401",
      quantity: 3,
    }]);
    for (const field of [
      "unit_price_amount",
      "total_amount",
      "currency",
      "is_donation",
      "counts_toward_capacity",
    ]) {
      expect(body).not.toHaveProperty(field);
      expect(body.option_selections[0]).not.toHaveProperty(field);
    }
  });

  it("keeps the free registration seats flow without a checkout-looking summary", async () => {
    await renderEvent(eventResponse());
    expect(screen.getByRole("spinbutton", { name: "Количество мест" })).toHaveValue(1);
    expect(screen.queryByRole("region", { name: "Итог регистрации" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Итого:|К оплате|Оплатить|Оплачено|Оплата прошла/)).not.toBeInTheDocument();
  });
});

describe("local form shell", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("shows linked accessible errors and focuses the first invalid field", async () => {
    await renderEvent();
    await userEvent.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Введите телефон.")).toHaveAttribute("id", "phone-error");
  });

  it("formats an international phone in one tel input and shows its detected flag", async () => {
    await renderEvent();
    const phone = screen.getByLabelText("Телефон");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByText("Можно указать номер любой страны")).toBeInTheDocument();

    fireEvent.change(phone, { target: { value: "79950955545" } });
    expect(phone).toHaveValue("+7 995 095-55-45");
    expect(screen.getByText("🇷🇺")).toBeInTheDocument();
  });

  it("renders a separate seats count with backend-contract boundaries", async () => {
    await renderEvent();
    const seatsCount = screen.getByRole("spinbutton", { name: "Количество мест" });
    expect(seatsCount).toHaveAttribute("type", "number");
    expect(seatsCount).toHaveAttribute("min", "1");
    expect(seatsCount).toHaveAttribute("max", "1000");
    expect(seatsCount).toHaveAttribute("step", "1");
    expect(seatsCount).toHaveAttribute("inputmode", "numeric");
    expect(seatsCount).toHaveValue(1);
  });

  it.each(["0", "-1", "1001", "1.5"])("rejects invalid seats count %s with an accessible error", async (value) => {
    const user = userEvent.setup();
    await renderEvent();
    await user.click(screen.getByLabelText(/Основное участие/));
    const seatsCount = screen.getByRole("spinbutton", { name: "Количество мест" });
    fireEvent.change(seatsCount, { target: { value } });
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(seatsCount).toHaveFocus();
    expect(seatsCount).toHaveAttribute("aria-invalid", "true");
    expect(seatsCount).toHaveAttribute("aria-describedby", "seats-count-error");
    expect(screen.getByText("Введите целое количество мест от 1 до 1000.")).toHaveAttribute("id", "seats-count-error");
  });

  it("keeps seats count independent from participation option quantity and event capacity", async () => {
    const data = eventResponse();
    data.event.capacity = 2;
    data.participation_options[0].allow_quantity = true;
    data.participation_options[0].min_quantity = 1;
    data.participation_options[0].max_quantity = 4;
    await renderEvent(data);
    const seatsCount = screen.getByRole("spinbutton", { name: "Количество мест" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Основное участие/ }));
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Основное участие" }));
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Основное участие" }));
    expect(screen.getByLabelText("Количество: Основное участие")).toHaveTextContent("3");
    expect(seatsCount).toHaveValue(1);
    fireEvent.change(seatsCount, { target: { value: "1000" } });
    expect(seatsCount).toHaveValue(1000);
    expect(screen.getByLabelText("Количество: Основное участие")).toHaveTextContent("3");
    expect(screen.queryByText(/остал|свободн/i)).not.toBeInTheDocument();
  });

  it("resets seats count to one when the event ID changes", async () => {
    const secondEventId = "77777777-7777-4777-8777-777777777777";
    const firstData = eventResponse();
    const secondData = eventResponse();
    secondData.event.id = secondEventId;
    secondData.event.title = "Другое мероприятие";
    secondData.participation_options.forEach((option) => { option.event_id = secondEventId; });
    vi.mocked(fetch).mockImplementation((input) => {
      const data = String(input).includes(secondEventId) ? secondData : firstData;
      return response({ data, error: null, meta: {} });
    });
    window.history.replaceState(null, "", `/events/${EVENT_ID}`);
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: firstData.event.title });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "12" } });
    expect(screen.getByRole("spinbutton", { name: "Количество мест" })).toHaveValue(12);

    window.history.pushState(null, "", `/events/${secondEventId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await screen.findByRole("heading", { level: 1, name: secondData.event.title });
    expect(screen.getByRole("spinbutton", { name: "Количество мест" })).toHaveValue(1);
  });

  it("presents one primary registration action and a secondary account route in a disclosure", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const confirm = screen.getByRole("button", { name: "Записаться на мероприятие" });
    expect(confirm).toHaveClass("registration-confirm", "consent-incomplete");
    expect(document.querySelectorAll(".registration-form .registration-confirm")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Создать аккаунт" })).not.toBeVisible();
    await user.click(screen.getByText("Что происходит с моими данными"));
    expect(screen.getByRole("button", { name: "Создать аккаунт" })).toHaveClass("text-button");
    expect(screen.getByText(/Регистрация не требует пароля/)).toBeVisible();
    expect(screen.getByText(/^Задайте пароль один раз/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Политика конфиденциальности/ })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/маркетинг/i)).not.toBeInTheDocument();
  });

  it("keeps the consent link separate from the keyboard-accessible checkbox", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const consent = screen.getByLabelText(/Я ознакомился/);
    const link = screen.getByRole("link", { name: /Согласие на регистрацию/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("label")).toBeNull();
    await user.click(link);
    expect(consent).not.toBeChecked();
    consent.focus();
    await user.keyboard(" ");
    expect(consent).toBeChecked();
    expect(consent.closest("section")).toHaveClass("checked");
    await user.click(link);
    expect(consent).toBeChecked();
    expect(screen.queryByText("Отметьте согласие выше, чтобы продолжить.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).not.toHaveClass("consent-incomplete");
    consent.focus();
    await user.tab();
    expect(link).toHaveFocus();
  });

  it.each(["Записаться на мероприятие", "Создать аккаунт"])("uses shared validation for %s", async (buttonName) => {
    const user = userEvent.setup();
    await renderEvent();
    if (buttonName === "Создать аккаунт") await user.click(screen.getByText("Что происходит с моими данными"));
    await user.click(screen.getByRole("button", { name: buttonName }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Телефон")).toHaveAttribute("aria-invalid", "true");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["Записаться на мероприятие", "Создать аккаунт"])("requires consent for %s", async (buttonName) => {
    const user = userEvent.setup();
    await renderEvent();
    expect(screen.getByText("Отметьте согласие выше, чтобы продолжить.")).toBeVisible();
    await fillValidForm(user, { consent: false });
    if (buttonName === "Создать аккаунт") await user.click(screen.getByText("Что происходит с моими данными"));
    await user.click(screen.getByRole("button", { name: buttonName }));
    const consent = screen.getByLabelText(/Я ознакомился/);
    expect(consent).toHaveFocus();
    expect(consent).toHaveAttribute("aria-invalid", "true");
    expect(consent).toHaveAttribute("aria-describedby", "consent-meta consent-error");
    expect(consent.closest("section")).toHaveClass("invalid");
    expect(screen.getByText("Подтвердите согласие для продолжения.")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows quantity only for a selected option and enforces returned boundaries", async () => {
    const data = eventResponse();
    data.participation_options[0].allow_quantity = true;
    data.participation_options[0].min_quantity = 2;
    data.participation_options[0].max_quantity = 4;
    await renderEvent(data);
    expect(screen.queryByLabelText("Количество: Основное участие")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /количество: Основное участие/i })).not.toBeInTheDocument();
    const user = userEvent.setup();
    const option = screen.getByRole("checkbox", { name: /Основное участие/ });
    await user.click(option);
    const quantity = screen.getByLabelText("Количество: Основное участие");
    const decrement = screen.getByRole("button", { name: "Уменьшить количество: Основное участие" });
    const increment = screen.getByRole("button", { name: "Увеличить количество: Основное участие" });
    expect(quantity).toHaveTextContent("2");
    expect(decrement).toBeDisabled();
    expect(increment).toBeEnabled();
    await user.click(increment);
    await user.click(increment);
    expect(quantity).toHaveTextContent("4");
    expect(increment).toBeDisabled();
    await user.click(option);
    expect(screen.queryByLabelText("Количество: Основное участие")).not.toBeInTheDocument();
    await user.click(option);
    expect(screen.getByLabelText("Количество: Основное участие")).toHaveTextContent("2");
  });

  it.each(["header", "strip"])("opens the shared page-level sign-in from %s and preserves form state on close", async (entry) => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    const initialUrl = window.location.href;
    const opener = entry === "header"
      ? within(screen.getByRole("banner")).getByRole("button", { name: "Войти" })
      : within(document.querySelector(".signin-strip") as HTMLElement).getByRole("button", { name: "Войти" });
    expect(document.querySelector(".signin-strip")?.nextElementSibling?.firstElementChild).toBe(screen.getByRole("group", { name: "Варианты участия" }));
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Войти в аккаунт" });
    expect(dialog.closest(".registration-form")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const email = within(dialog).getByLabelText("Email");
    expect(email).toHaveValue("anna@example.ru");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("autocomplete", "email");
    await user.tab();
    expect(within(dialog).getByLabelText("Пароль")).toHaveFocus();
    expect(within(dialog).getByLabelText("Пароль")).toHaveAttribute("autocomplete", "current-password");
    await user.type(within(dialog).getByLabelText("Пароль"), "unsent-password");
    if (entry === "header") await user.keyboard("{Escape}");
    else await user.click(within(dialog).getByRole("button", { name: "Закрыть вход" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveValue("Анна Мария");
    expect(screen.getByLabelText("Email")).toHaveValue("anna@example.ru");
    expect(screen.getByLabelText(/Я ознакомился/)).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Основное участие/ })).toBeChecked();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(initialUrl);
    await user.click(opener);
    expect(screen.getByLabelText("Пароль")).toHaveValue("");
    const reopened = screen.getByRole("dialog");
    await user.click(within(reopened).getByRole("heading"));
    expect(reopened).toBeInTheDocument();
    fireEvent.pointerDown(reopened);
    fireEvent.click(reopened);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("does not restore an authenticated account from persistent browser storage", async () => {
    window.localStorage.setItem("access_token", "stored-access-token");
    window.sessionStorage.setItem("refresh_token", "stored-refresh-token");
    window.localStorage.setItem("password", "stored-password");
    const storageReadSpy = vi.spyOn(Storage.prototype, "getItem");

    await renderEvent();

    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" })).toBeInTheDocument();
    expect(storageReadSpy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("discards a pending sign-in when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    let finishLogin!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishLogin = resolve; }))
      .mockImplementationOnce(() => response({
        user: { email: "ivan@example.ru", email_verified_at: EXPIRES_AT },
        profile: { first_name: "Иван", last_name: "Иванов", phone: "+79000000001" },
        memberships: [],
      }))
      .mockImplementationOnce(() => response({ ok: true }));
    const opener = within(screen.getByRole("banner")).getByRole("button", { name: "Войти" });
    await user.click(opener);
    await user.type(screen.getByLabelText("Пароль"), "secret-password");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Входим…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
    await act(async () => {
      finishLogin(await response({
        access_token: "temporary-access-token",
        refresh_token: "temporary-refresh-token",
        token_type: "bearer",
        expires_at: EXPIRES_AT,
        user: {},
      }));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      body: JSON.stringify({ refresh_token: "temporary-refresh-token" }),
    })));
    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("anna@example.ru");
  });

  it("uses temporary in-memory login and canonical account data for completed registration", async () => {
    const user = userEvent.setup();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent();
    await fillValidForm(user);
    const initialUrl = window.location.href;
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        access_token: "temporary-access-token",
        refresh_token: "temporary-refresh-token",
        token_type: "bearer",
        expires_at: EXPIRES_AT,
        user: {},
      }))
      .mockImplementationOnce(() => response({
        user: { email: "ivan@example.ru", email_verified_at: EXPIRES_AT },
        profile: { first_name: "Иван", last_name: "Иванов", phone: "+79000000001" },
        memberships: [],
      }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
    const loginEmail = screen.getByLabelText("Email", { selector: "#login-email" });
    await user.clear(loginEmail);
    await user.type(loginEmail, "ivan@example.ru");
    await user.type(screen.getByLabelText("Пароль"), "secret-password");
    await user.click(within(screen.getByRole("dialog", { name: "Войти в аккаунт" })).getByRole("button", { name: "Войти" }));
    const accountPanel = await screen.findByRole("region", { name: "Аккаунт" });
    expect(within(accountPanel).getByText("Вы вошли")).toBeInTheDocument();
    expect(within(accountPanel).getByText("Иван Иванов")).toBeInTheDocument();
    expect(within(accountPanel).getByText("ivan@example.ru")).toBeInTheDocument();
    expect(accountPanel).toHaveFocus();
    expect(screen.getAllByText("ivan@example.ru")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Войти" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать аккаунт" })).not.toBeInTheDocument();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(initialUrl);

    vi.mocked(fetch)
      .mockImplementationOnce(() => response(intentCreated("completed"), 201))
      .mockImplementationOnce(() => response(envelope({
        state: "confirmed",
        expires_at: null,
        registration: registrationResult().data.registration,
        account_next_step: "sign_in",
      })));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(await screen.findByRole("heading", { name: "Регистрация успешно сохранена" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body));
    expect(request).toMatchObject({
      first_name: "Иван",
      last_name: "Иванов",
      phone: "+79000000001",
      email: "ivan@example.ru",
    });
    expect(vi.mocked(fetch).mock.calls[3][1]?.headers).toMatchObject({ Authorization: "Bearer temporary-access-token" });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(window.location.href).not.toContain("temporary-access-token");
    expect(window.location.href).not.toContain("secret-password");
  });

  it("uses the signed-in canonical email for public privacy verification and keeps auth on invalid code or cancel", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const dialog = await openSignedInDeletion(user);
    const email = within(dialog).getByLabelText("Email для подтверждения удаления");
    expect(email).toHaveValue("ivan@example.ru");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();

    vi.mocked(fetch).mockImplementationOnce(() => response(envelope({ accepted: true }), 202));
    await user.click(within(dialog).getByRole("button", { name: "Получить код подтверждения" }));
    const codeInput = await screen.findByLabelText("Код подтверждения удаления");
    expect(codeInput).toHaveFocus();
    await user.type(codeInput, "12a34b56");
    expect(codeInput).toHaveValue("123456");

    vi.mocked(fetch).mockImplementationOnce(() => response(
      apiError("invalid_or_expired_privacy_code", "email exists; paid invoice 42"),
      400,
    ));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверный или просроченный код.");
    expect(screen.queryByText(/paid invoice|email exists/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();

    const requestCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/privacy/access/request"));
    const confirmCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/privacy/access/confirm"));
    expect(requestCall?.[1]?.body).toBe(JSON.stringify({ email: "ivan@example.ru" }));
    expect(confirmCall?.[1]?.body).toBe(JSON.stringify({ email: "ivan@example.ru", code: "123456" }));
    expect(requestCall?.[1]?.headers).not.toHaveProperty("Authorization");
    expect(confirmCall?.[1]?.headers).not.toHaveProperty("Authorization");

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();
  });

  it("retries confirm-erasure with the same request and clears account plus tickets on deletion_pending", async () => {
    const user = userEvent.setup();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent();
    const initialUrl = window.location.href;
    const accountPanel = await signInExistingAccount(user, "normal-account-access-token");
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope([myRegistration()])));
    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    expect(await screen.findByRole("heading", { name: "Мои билеты" })).toBeInTheDocument();
    await user.click(within(accountPanel).getByRole("button", { name: "Управление аккаунтом" }));
    await user.click(within(accountPanel).getByRole("button", { name: "Удалить аккаунт" }));

    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope({ accepted: true }), 202))
      .mockImplementationOnce(() => response(privacySession()))
      .mockImplementationOnce(() => response(deletionPrivacyRequest(), 201))
      .mockRejectedValueOnce(new Error("socket timeout"));
    await user.click(screen.getByRole("button", { name: "Получить код подтверждения" }));
    await user.type(screen.getByLabelText("Код подтверждения удаления"), "123456");
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(await screen.findByRole("heading", { name: "Подтвердите удаление аккаунта" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Нет, вернуться" }));
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить аккаунт" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Проверьте соединение");
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();

    vi.mocked(fetch)
      .mockImplementationOnce(() => response(deletionPendingLifecycle()))
      .mockImplementationOnce(() => response({ ok: true }));
    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить аккаунт" }));
    expect(await screen.findByRole("heading", { name: "Запрос на удаление подтверждён" })).toBeInTheDocument();
    expect(screen.getByText(/Доступ к аккаунту остановлен.*правилами хранения данных/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).toBeInTheDocument();

    const createCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/privacy/requests"));
    const confirmCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/confirm-erasure"));
    expect(createCalls).toHaveLength(1);
    expect(confirmCalls).toHaveLength(2);
    expect(confirmCalls.map(([input]) => String(input))).toEqual([
      `/api/privacy/requests/${PRIVACY_REQUEST_ID}/confirm-erasure`,
      `/api/privacy/requests/${PRIVACY_REQUEST_ID}/confirm-erasure`,
    ]);
    for (const call of [...createCalls, ...confirmCalls]) {
      expect(call[1]?.headers).toMatchObject({ Authorization: "Bearer privacy-session-token" });
      expect(call[1]?.headers).not.toMatchObject({ Authorization: "Bearer normal-account-access-token" });
    }
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(initialUrl);
    expect(window.location.href).not.toContain("privacy-session-token");
    expect(window.location.href).not.toContain(PRIVACY_REQUEST_ID);
    expect(window.location.href).not.toContain("123456");
  });

  it("returns an expired privacy session to code verification without corrupting ordinary auth", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await openSignedInDeletion(user);
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope({ accepted: true }), 202))
      .mockImplementationOnce(() => response(privacySession()))
      .mockImplementationOnce(() => response(deletionPrivacyRequest(), 201))
      .mockImplementationOnce(() => response(apiError("privacy_session_expired"), 401));
    await user.click(screen.getByRole("button", { name: "Получить код подтверждения" }));
    await user.type(screen.getByLabelText("Код подтверждения удаления"), "123456");
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить аккаунт" }));

    expect(await screen.findByLabelText("Код подтверждения удаления")).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Сеанс подтверждения истёк");
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
  });

  it("shows generic manual processing copy without backend financial details", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await openSignedInDeletion(user);
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope({ accepted: true }), 202))
      .mockImplementationOnce(() => response(privacySession()))
      .mockImplementationOnce(() => response(deletionPrivacyRequest(), 201))
      .mockImplementationOnce(() => response(
        apiError("privacy_erasure_manual_review_required", "payment event 123 requires retention"),
        409,
      ));
    await user.click(screen.getByRole("button", { name: "Получить код подтверждения" }));
    await user.type(screen.getByLabelText("Код подтверждения удаления"), "123456");
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить аккаунт" }));

    expect(await screen.findByRole("heading", { name: "Требуется дополнительная обработка" })).toBeInTheDocument();
    expect(screen.queryByText(/payment|event 123|retention/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Аккаунт" })).toBeInTheDocument();
  });

  it("never offers or fetches My Tickets while signed out", async () => {
    await renderEvent();

    expect(screen.queryByRole("button", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/me/registrations")))
      .toBe(false);
  });

  it("opens My Tickets with loading, empty, retryable error, and clean close states", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const accountPanel = await signInExistingAccount(user);
    expect(within(accountPanel).getByRole("button", { name: "Мои билеты" })).toBeInTheDocument();

    let resolveTickets!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolveTickets = resolve; }));
    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    expect(await screen.findByText("Загружаем ваши регистрации…")).toBeInTheDocument();
    resolveTickets(await response(envelope([])));
    expect(await screen.findByText("У вас пока нет регистраций.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Назад к регистрации" }));
    expect(screen.queryByRole("heading", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).toBeInTheDocument();
    await waitFor(() => expect(within(accountPanel).getByRole("button", { name: "Мои билеты" })).toHaveFocus());

    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        data: null,
        error: { code: "internal_error", message: "token=secret backend trace" },
        meta: {},
      }, 500))
      .mockImplementationOnce(() => response(envelope([])));
    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось загрузить регистрации");
    expect(alert).not.toHaveTextContent("token=secret");
    await user.click(within(alert).getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("У вас пока нет регистраций.")).toBeInTheDocument();
  });

  it("renders realistic canonical ticket metadata, truthful payment copy, and active/past tabs", async () => {
    const user = userEvent.setup();
    await renderEvent();
    const accountPanel = await signInExistingAccount(user, "tickets-access-token");
    const pending = myRegistration({
      event: { starts_at: "2099-09-12T15:00:00+03:00", ends_at: "2099-09-12T18:00:00+03:00" },
    });
    expect((pending.event as unknown as Record<string, unknown>).community_id).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    const free = myRegistration({
      id: "77777777-7777-4777-8777-777777777711",
      event: {
        title: "Бесплатная встреча",
        starts_at: "2099-10-12T15:00:00+03:00",
        ends_at: "2099-10-12T18:00:00+03:00",
        registration_mode: "internal_free",
      },
      payment_status: "not_required",
      selected_options: [],
      capacity_reservations: [],
      total_amount: null,
      total_currency: null,
    });
    const succeeded = myRegistration({
      id: "77777777-7777-4777-8777-777777777712",
      event: {
        title: "Оплаченная встреча",
        starts_at: "2099-11-12T15:00:00+03:00",
        ends_at: "2099-11-12T18:00:00+03:00",
      },
      payment_status: "succeeded",
    });
    const refundedPastOccurrence = myRegistration({
      id: "77777777-7777-4777-8777-777777777713",
      event: {
        title: "Прошедшая встреча",
        starts_at: "2099-12-12T15:00:00+03:00",
        ends_at: "2099-12-12T18:00:00+03:00",
      },
      occurrence: {
        title: "Прошедшая суббота",
        starts_at: "2000-01-12T15:00:00+03:00",
        ends_at: "2000-01-12T18:00:00+03:00",
      },
      payment_status: "refunded",
    });
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope([
      pending,
      free,
      succeeded,
      refundedPastOccurrence,
    ])));

    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    const ticketsPanel = await screen.findByRole("region", { name: "Мои билеты" });
    const pendingCard = within(ticketsPanel).getByRole("heading", { name: "Шаббат для друзей" })
      .closest(".ticket-card") as HTMLElement;
    expect(within(pendingCard).getByText("Оплата ожидается", { selector: ".ticket-badge" })).toBeInTheDocument();
    expect(within(pendingCard).queryByText("Оплачено")).not.toBeInTheDocument();
    expect(pendingCard).toHaveTextContent("Общинный центр, Москва, ул. Примерная, 1");
    expect(pendingCard).toHaveTextContent("Основное участие × 2");
    expect(pendingCard).toHaveTextContent("Мария Иванова");
    expect(pendingCard).toHaveTextContent(/3.?000/);
    expect(pendingCard).toHaveTextContent("Подтверждено");
    expect(within(ticketsPanel).getByRole("heading", { name: "Бесплатная встреча" }).closest(".ticket-card"))
      .toHaveTextContent("Бесплатно");
    expect(within(ticketsPanel).getByRole("heading", { name: "Оплаченная встреча" }).closest(".ticket-card"))
      .toHaveTextContent("Оплачено");
    expect(ticketsPanel).not.toHaveTextContent(pending.id);
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.headers).toMatchObject({
      Authorization: "Bearer tickets-access-token",
    });

    await user.click(within(ticketsPanel).getByRole("tab", { name: "Прошедшие" }));
    expect(within(ticketsPanel).getByRole("heading", { name: "Прошедшая встреча" })).toBeInTheDocument();
    expect(ticketsPanel).toHaveTextContent("Прошедшая суббота");
    expect(ticketsPanel).toHaveTextContent("Возврат");
    expect(within(ticketsPanel).queryByRole("heading", { name: "Шаббат для друзей" })).not.toBeInTheDocument();
  });

  it("clears rendered ticket history immediately on logout and after an expired session", async () => {
    const user = userEvent.setup();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent();
    const accountPanel = await signInExistingAccount(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope([myRegistration()])))
      .mockImplementationOnce(() => response({ ok: true }));
    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    const ticketsPanel = await screen.findByRole("region", { name: "Мои билеты" });
    expect(within(ticketsPanel).getByRole("heading", { name: "Шаббат для друзей" })).toBeInTheDocument();
    await user.click(within(accountPanel).getByRole("button", { name: "Выйти" }));
    expect(screen.queryByRole("heading", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Шаббат для друзей", level: 3 })).not.toBeInTheDocument();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);

    const nextAccountPanel = await signInExistingAccount(user, "expired-access-token");
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        data: null,
        error: { code: "authentication_required", message: "raw auth detail" },
        meta: {},
      }, 401))
      .mockImplementationOnce(() => response({ ok: true }));
    await user.click(within(nextAccountPanel).getByRole("button", { name: "Мои билеты" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument());
    expect(screen.queryByText("raw auth detail")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Мои билеты" })).not.toBeInTheDocument();
  });

  it("refreshes open My Tickets after an authenticated registration completes", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    const accountPanel = await signInExistingAccount(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope([])));
    await user.click(within(accountPanel).getByRole("button", { name: "Мои билеты" }));
    expect(await screen.findByText("У вас пока нет регистраций.")).toBeInTheDocument();

    const newTicket = myRegistration({ id: REGISTRATION_ID });
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(intentCreated("completed"), 201))
      .mockImplementationOnce(() => response(envelope({
        state: "confirmed",
        expires_at: null,
        registration: registrationResult().data.registration,
        account_next_step: "sign_in",
      })))
      .mockImplementationOnce(() => response(envelope([newTicket])));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));

    expect(await screen.findByRole("heading", { name: "Регистрация успешно сохранена" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Шаббат для друзей", level: 3 })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/me/registrations")))
      .toHaveLength(2);
  });

  it("signs out through the shared session and returns registration to anonymous mode", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        access_token: "temporary-access-token",
        refresh_token: "temporary-refresh-token",
        token_type: "bearer",
        expires_at: EXPIRES_AT,
        user: {},
      }))
      .mockImplementationOnce(() => response({
        user: { email: "ivan@example.ru", email_verified_at: EXPIRES_AT },
        profile: { first_name: "Иван", last_name: "Иванов", phone: "+79000000001" },
        memberships: [],
      }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
    const loginEmail = screen.getByLabelText("Email", { selector: "#login-email" });
    await user.clear(loginEmail);
    await user.type(loginEmail, "ivan@example.ru");
    await user.type(screen.getByLabelText("Пароль"), "secret-password");
    await user.click(within(screen.getByRole("dialog", { name: "Войти в аккаунт" })).getByRole("button", { name: "Войти" }));

    const accountPanel = await screen.findByRole("region", { name: "Аккаунт" });
    vi.mocked(fetch).mockImplementationOnce(() => response({ ok: true }));
    await user.click(within(accountPanel).getByRole("button", { name: "Выйти" }));

    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).toBeInTheDocument();
    expect(screen.getByText("Что происходит с моими данными")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveValue("Анна Мария");
    expect(screen.getByLabelText("Email", { selector: "#email" })).toHaveValue("anna@example.ru");
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ refresh_token: "temporary-refresh-token" }),
    })));
  });

  it("shows safe generic login errors", async () => {
    const user = userEvent.setup();
    await renderEvent();
    vi.mocked(fetch).mockImplementationOnce(() => response({
      data: null,
      error: { code: "authentication_required", message: "email exists but password mismatch" },
      meta: {},
    }, 401));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
    await user.type(screen.getByLabelText("Email", { selector: "#login-email" }), "ivan@example.ru");
    await user.type(screen.getByLabelText("Пароль"), "wrong-password");
    await user.click(within(screen.getByRole("dialog", { name: "Войти в аккаунт" })).getByRole("button", { name: "Войти" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Неверный email или пароль.");
    expect(alert).not.toHaveTextContent("email exists");
  });

  it("shows the incomplete-account path when /auth/me has no profile", async () => {
    const user = userEvent.setup();
    await renderEvent();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        access_token: "temporary-access-token",
        refresh_token: "temporary-refresh-token",
        token_type: "bearer",
        expires_at: EXPIRES_AT,
        user: {},
      }))
      .mockImplementationOnce(() => response({
        user: { email: "ivan@example.ru", email_verified_at: EXPIRES_AT },
        profile: null,
        memberships: [],
      }))
      .mockImplementationOnce(() => response({ ok: true }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
    await user.type(screen.getByLabelText("Email", { selector: "#login-email" }), "ivan@example.ru");
    await user.type(screen.getByLabelText("Пароль"), "secret-password");
    await user.click(within(screen.getByRole("dialog", { name: "Войти в аккаунт" })).getByRole("button", { name: "Войти" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("В аккаунте не заполнены данные, необходимые для регистрации. Вы можете продолжить регистрацию без входа.");
    expect(alert).not.toHaveTextContent("Не удалось войти");
    expect(screen.getByRole("button", { name: "Отмена" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["Записаться на мероприятие", "without_password"],
    ["Создать аккаунт", "create_account"],
  ] as const)("normalizes names and submits %s through the shared intent flow", async (buttonName, accountChoice) => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    if (buttonName === "Создать аккаунт") await user.click(screen.getByText("Что происходит с моими данными"));
    await user.click(screen.getByRole("button", { name: buttonName }));
    expect(await screen.findByLabelText("Код подтверждения")).toHaveFocus();
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(request).toMatchObject({
      event_id: EVENT_ID,
      occurrence_id: null,
      first_name: "Анна Мария",
      last_name: "Иванова",
      phone: "+79991234567",
      email: "anna@example.ru",
      seats_count: 1,
      option_selections: [{ option_id: OPTION_ID, quantity: 1 }],
      questionnaire_form_id: null,
      answers: [],
      legal_acceptances: [{ document_id: "55555555-5555-4555-8555-555555555555", content_hash: "consent-hash" }],
      account_choice: accountChoice,
    });
    expect(request.legal_acceptances).toHaveLength(1);
    expect(request.idempotency_key).toMatch(/^web-[a-f0-9]{48}$/);
  });

  it("does not persist or expose edited form data", async () => {
    const user = userEvent.setup();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent();
    await user.type(screen.getByLabelText("Имя"), "Секретное Имя");
    await user.type(screen.getByLabelText("Email"), "secret@example.test");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "17" } });
    await user.click(screen.getByLabelText(/Основное участие/));
    await user.click(screen.getByLabelText(/Я ознакомился/));
    await user.click(screen.getByText("Что происходит с моими данными"));
    await user.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).not.toContain("secret");
    expect(window.location.href).not.toContain("17");
    expect(window.location.href).not.toContain("create_account");
    expect(document.title).not.toContain("secret");
    expect(within(document.body).queryByText("secret@example.test")).not.toBeInTheDocument();
  });

  it("renders all ordinary questionnaire controls with purpose and retention", async () => {
    await renderEvent(responseWithQuestionnaire());
    expect(screen.getByRole("heading", { name: "Дополнительные вопросы" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Код встречи/)).toHaveAttribute("type", "text");
    expect(screen.getByLabelText(/Комментарий по прибытию/).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("group", { name: /Выберите вход/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Выберите сессии/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Нужен бейдж/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Цель:/)).toHaveLength(5);
    expect(screen.getByText((_content, element) => Boolean(
      element?.classList.contains("questionnaire-help")
      && element.textContent?.includes("Хранение: 7 дн.") === true,
    ))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Да" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Нет" })).not.toBeChecked();
  });

  it("focuses the first invalid questionnaire field and enforces multi-select bounds", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithQuestionnaire());
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(screen.getByLabelText(/Код встречи/)).toHaveFocus();
    expect(document.getElementById(`questionnaire-${QUESTION_IDS.short}-error`)).toHaveTextContent(
      "Ответьте на обязательный вопрос.",
    );

    await fillValidQuestionnaire(user);
    await user.click(screen.getByRole("checkbox", { name: "Вторая" }));
    await user.click(screen.getByRole("checkbox", { name: "Третья" }));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(screen.getByRole("checkbox", { name: "Первая" })).toHaveFocus();
    expect(screen.getByText("Выберите не более 2 вариантов.")).toBeInTheDocument();
  });

  it("submits the exact questionnaire version and only field IDs plus normalized values", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithQuestionnaire());
    await fillValidForm(user);
    await fillValidQuestionnaire(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(body.questionnaire_form_id).toBe(QUESTIONNAIRE_FORM_ID);
    expect(body.answers).toEqual([
      { field_id: QUESTION_IDS.short, value: "ok" },
      { field_id: QUESTION_IDS.long, value: "Обычный комментарий" },
      { field_id: QUESTION_IDS.single, value: "north" },
      { field_id: QUESTION_IDS.multi, value: ["one"] },
      { field_id: QUESTION_IDS.boolean, value: false },
    ]);
    expect(JSON.stringify(body.answers)).not.toMatch(/label|purpose|Код встречи|Цель/);
  });

  it("shows safe refresh guidance when the questionnaire changed", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithQuestionnaire());
    await fillValidForm(user);
    await fillValidQuestionnaire(user);
    vi.mocked(fetch).mockImplementationOnce(() => response({
      data: null,
      error: { code: "questionnaire_changed", message: "internal version details" },
      meta: {},
    }, 409));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Анкета регистрации была обновлена. Обновите страницу и заполните дополнительные вопросы ещё раз.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("internal version details");
  });

  it("keeps questionnaire answers only in React memory", async () => {
    const user = userEvent.setup();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent(responseWithQuestionnaire());
    await user.type(screen.getByLabelText(/Код встречи/), "secret-answer");
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).not.toContain("secret-answer");
  });
});

describe("registration intent and account claim flow", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  async function setupValidForm(data = eventResponse(), search = "") {
    const user = userEvent.setup();
    await renderEvent(data, search);
    await fillValidForm(user);
    return user;
  }

  function flowDialog() {
    return screen.getByRole("dialog", { name: "Оформление регистрации" });
  }

  function expectOneFlowDialog() {
    const dialog = flowDialog();
    expect(dialog).toHaveAttribute("open");
    expect(screen.getAllByRole("dialog")).toEqual([dialog]);
    expect(document.querySelectorAll("dialog[open], [aria-modal='true']")).toHaveLength(1);
    return dialog;
  }

  it.each(["Escape", "close", "backdrop", "cancel"])("dismisses confirmation through %s and resumes the same intent with preserved inputs", async (dismissal) => {
    const user = await setupValidForm(responseWithQuestionnaire());
    await fillValidQuestionnaire(user);
    const pageForm = screen.getByLabelText("Имя").closest("form");
    const nameInput = screen.getByLabelText("Имя");
    const opener = screen.getByRole("button", { name: "Записаться на мероприятие" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await createIntent(user);
    const dialog = expectOneFlowDialog();
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.closest("form")).toBeNull();
    expect(nameInput.closest("form")).toBe(pageForm);
    expect(within(dialog).getByLabelText("Код подтверждения")).toHaveFocus();
    expect(within(dialog).getByLabelText("Этапы регистрации")).toHaveTextContent("ПодтверждениеОплатаАккаунт");
    await user.type(within(dialog).getByLabelText("Код подтверждения"), "12a345");
    const expiry = within(dialog).getByText(/Текущий срок действия/).textContent;
    const callCount = vi.mocked(fetch).mock.calls.length;

    if (dismissal === "Escape") await user.keyboard("{Escape}");
    else if (dismissal === "close") await user.click(within(dialog).getByRole("button", { name: "Закрыть оформление регистрации" }));
    else if (dismissal === "cancel") fireEvent(dialog, new Event("cancel", { cancelable: true }));
    else await user.click(dialog);

    expect(dialog).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Код подтверждения")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toBe(nameInput);
    expect(nameInput).toHaveValue("Анна Мария");
    expect(screen.getByLabelText("Email")).toHaveValue("anna@example.ru");
    expect(screen.getByRole("checkbox", { name: /Основное участие/ })).toBeChecked();
    expect(screen.getByLabelText(/Я ознакомился/)).toBeChecked();
    expect(screen.getByLabelText(/Комментарий по прибытию/)).toHaveValue("Обычный комментарий");
    expect(screen.getByRole("radio", { name: "Северный" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }));
    expectOneFlowDialog();
    expect(screen.getByLabelText("Код подтверждения")).toHaveValue("12345");
    expect(screen.getByLabelText("Код подтверждения")).toHaveFocus();
    expect(screen.getByText(/Текущий срок действия/)).toHaveTextContent(expiry!);
    expect(fetch).toHaveBeenCalledTimes(callCount);
  });

  it("keeps a late confirmation result closed until the user resumes it", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    let finishConfirmation!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishConfirmation = resolve; }));
    await user.type(screen.getByLabelText("Код подтверждения"), "123456");
    await user.click(within(flowDialog()).getByRole("button", { name: "Подтвердить email" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить подтверждение" })).toHaveFocus();
    await act(async () => finishConfirmation(await response(registrationResult())));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const callCount = vi.mocked(fetch).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Посмотреть регистрацию" }));
    expectOneFlowDialog();
    expect(within(flowDialog()).getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(callCount);
  });

  it("does not stack a late intent dialog on top of page-level sign-in", async () => {
    const user = await setupValidForm();
    let finishIntent!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishIntent = resolve; }));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Войти" }));
    const login = screen.getByRole("dialog", { name: "Войти в аккаунт" });
    await act(async () => finishIntent(await response(intentCreated(), 201)));
    expect(screen.getAllByRole("dialog")).toEqual([login]);
    expect(screen.queryByRole("dialog", { name: "Оформление регистрации" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }));
    expectOneFlowDialog();
    expect(screen.getByLabelText("Код подтверждения")).toHaveFocus();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves selected date, seat quantity, and option quantity while confirmation is closed", async () => {
    const data = responseWithOccurrences();
    data.participation_options[0].allow_quantity = true;
    data.participation_options[0].max_quantity = 4;
    const user = await setupValidForm(data, "?occurrence=" + OCCURRENCE_TWO_ID);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Основное участие" }));
    const quantity = screen.getByLabelText("Количество: Основное участие");
    await createIntent(user);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("spinbutton", { name: "Количество мест" })).toHaveValue(3);
    expect(quantity).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }));
    await confirmIntent(user, registrationResult("confirmed", "none", OCCURRENCE_TWO_ID));
    expect(within(flowDialog()).getByText("Выбранная дата")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input).endsWith("/registration-intents") && init?.method === "POST")).toHaveLength(1);
  });

  it("preserves Retry-After cooldown and ambiguous confirmation recovery across dismissals", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(apiError("resend_cooldown"), 429, { "Retry-After": "60" }));
    await user.click(within(flowDialog()).getByRole("button", { name: "Отправить код повторно" }));
    expect(await screen.findByRole("button", { name: /Повторная отправка через/ })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }));
    expect(within(flowDialog()).getByRole("button", { name: /Повторная отправка через/ })).toBeDisabled();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("connection lost"));
    await user.type(screen.getByLabelText("Код подтверждения"), "123456");
    await user.click(within(flowDialog()).getByRole("button", { name: "Подтвердить email" }));
    await screen.findByRole("button", { name: "Проверить статус" });
    await user.keyboard("{Escape}");
    const callCount = vi.mocked(fetch).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Продолжить подтверждение" }));
    expect(fetch).toHaveBeenCalledTimes(callCount);
    expect(screen.getByLabelText("Код подтверждения")).toHaveValue("123456");
    expect(within(flowDialog()).getByRole("alert")).toHaveTextContent("Проверьте статус");
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope({
      state: "confirmed",
      expires_at: null,
      registration: registrationResult().data.registration,
      account_next_step: "set_password",
    })));
    await user.click(within(flowDialog()).getByRole("button", { name: "Проверить статус" }));
    expect(await screen.findByRole("button", { name: "Запросить код задания пароля" })).toBeInTheDocument();
    expectOneFlowDialog();
    expect(screen.queryByLabelText("Новый пароль")).not.toBeInTheDocument();
  });

  it("restarts only through the explicit restart action and creates a fresh intent", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    const firstRequest = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    await user.type(screen.getByLabelText("Код подтверждения"), "123");
    await user.click(within(flowDialog()).getByRole("button", { name: "Изменить данные и начать заново" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записаться на мероприятие" })).toHaveFocus();
    expect(screen.getByLabelText("Email")).toBeEnabled();
    await createIntent(user);
    expect(screen.getByLabelText("Код подтверждения")).toHaveValue("");
    const nextRequest = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(nextRequest.idempotency_key).not.toBe(firstRequest.idempotency_key);
  });

  it.each(["none", "set_password"] as const)("resumes the saved %s result without another intent or auth request", async (nextStep) => {
    const user = await setupValidForm();
    await createIntent(user, nextStep === "set_password" ? "Создать аккаунт" : "Записаться на мероприятие");
    const originalDialog = flowDialog();
    await confirmIntent(user, registrationResult("confirmed", nextStep));
    expect(flowDialog()).toBe(originalDialog);
    expect(screen.getByRole("heading", { name: "Регистрация успешно сохранена" })).toHaveFocus();
    if (nextStep === "set_password") {
      await user.type(screen.getByLabelText("Новый пароль"), "preserved-password");
      await user.type(screen.getByLabelText("Повтор нового пароля"), "preserved-password");
    } else {
      expect(within(flowDialog()).queryByRole("button", { name: /Задать пароль|Запросить код задания пароля/ })).not.toBeInTheDocument();
    }
    await user.click(within(flowDialog()).getByRole("button", { name: "Готово" }));
    const callCount = vi.mocked(fetch).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Посмотреть регистрацию" }));
    expectOneFlowDialog();
    expect(within(flowDialog()).getByText("Не требуется")).toBeInTheDocument();
    expect(within(flowDialog()).getByText("Регистрация подтверждена.")).toBeInTheDocument();
    if (nextStep === "set_password") {
      expect(screen.getByLabelText("Новый пароль")).toHaveValue("preserved-password");
      expect(screen.getByLabelText("Повтор нового пароля")).toHaveValue("preserved-password");
    }
    expect(fetch).toHaveBeenCalledTimes(callCount);
  });

  async function openFlowSignIn(user: ReturnType<typeof userEvent.setup>) {
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "sign_in"));
    const dialog = expectOneFlowDialog();
    expect(within(dialog).getByText(/Регистрация уже сохранена.*Вход необязателен/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Войти" }));
    expect(flowDialog()).toBe(dialog);
    expectOneFlowDialog();
    expect(screen.queryByRole("dialog", { name: "Войти в аккаунт" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toHaveValue("anna@example.ru");
    expect(within(dialog).getByLabelText("Email")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("Пароль")).toHaveFocus();
    return dialog;
  }

  function mockFlowLogin(profile: { first_name: string; last_name: string; phone: string } | null) {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response({
        access_token: "flow-access-token", refresh_token: "flow-refresh-token",
        token_type: "bearer", expires_at: EXPIRES_AT, user: {},
      }))
      .mockImplementationOnce(() => response({
        user: { email: "anna@example.ru", email_verified_at: EXPIRES_AT }, profile, memberships: [],
      }));
  }

  it("allows declining login while keeping the saved result and a later sign-in option", async () => {
    const user = await setupValidForm();
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "sign_in"));
    const callCount = vi.mocked(fetch).mock.calls.length;
    await user.click(within(flowDialog()).getByRole("button", { name: "Продолжить без входа" }));
    expect(within(flowDialog()).getByText("Вы продолжили без входа. Регистрация остаётся сохранённой.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Посмотреть регистрацию" }));
    expect(within(flowDialog()).getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(within(flowDialog()).getByRole("button", { name: "Войти" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(callCount);
  });

  it("signs in within the same flow and hydrates the canonical account without persisting credentials", async () => {
    const user = await setupValidForm();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const originalUrl = window.location.href;
    const dialog = await openFlowSignIn(user);
    mockFlowLogin({ first_name: "Анна", last_name: "Иванова", phone: "+79991234567" });
    await user.type(within(dialog).getByLabelText("Пароль"), "flow-password");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("region", { name: "Аккаунт" })).toHaveTextContent("Анна Иванова");
    expectOneFlowDialog();
    expect(flowDialog()).toBe(dialog);
    expect(within(dialog).getByText("Вход выполнен. Регистрация сохранена в вашем аккаунте.")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Регистрация успешно сохранена" })).toHaveFocus();
    expect(within(dialog).queryByLabelText("Пароль")).not.toBeInTheDocument();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(originalUrl);
    await user.click(within(dialog).getByRole("button", { name: "Готово" }));
    expect(screen.getByRole("button", { name: "Посмотреть регистрацию" })).toHaveFocus();
  });

  it("cleans up an incomplete in-flow account and preserves the registration", async () => {
    const user = await setupValidForm();
    const dialog = await openFlowSignIn(user);
    mockFlowLogin(null);
    vi.mocked(fetch).mockImplementationOnce(() => response({ ok: true }));
    await user.type(within(dialog).getByLabelText("Пароль"), "flow-password");
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("В аккаунте не заполнены данные");
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      body: JSON.stringify({ refresh_token: "flow-refresh-token" }),
    }));
    expect(within(dialog).getByLabelText("Пароль")).toHaveValue("");
    expect(within(dialog).getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expectOneFlowDialog();
  });

  it("keeps in-flow login errors generic and allows cancelling the panel", async () => {
    const user = await setupValidForm();
    const dialog = await openFlowSignIn(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(apiError("authentication_required", "email exists"), 401));
    await user.type(within(dialog).getByLabelText("Пароль"), "wrong-password");
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Неверный email или пароль.");
    expect(within(dialog).getByRole("alert")).not.toHaveTextContent("email exists");
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(within(dialog).queryByLabelText("Пароль")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Регистрация успешно сохранена" })).toHaveFocus();
    expectOneFlowDialog();
  });

  it("cleans up a pending in-flow sign-in after dismissal without losing the result", async () => {
    const user = await setupValidForm();
    const dialog = await openFlowSignIn(user);
    let finishLogin!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishLogin = resolve; }))
      .mockImplementationOnce(() => response({
        user: { email: "anna@example.ru", email_verified_at: EXPIRES_AT },
        profile: { first_name: "Анна", last_name: "Иванова", phone: "+79991234567" }, memberships: [],
      }))
      .mockImplementationOnce(() => response({ ok: true }));
    await user.type(within(dialog).getByLabelText("Пароль"), "abandoned-password");
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => finishLogin(await response({
      access_token: "abandoned-access-token", refresh_token: "abandoned-refresh-token",
      token_type: "bearer", expires_at: EXPIRES_AT, user: {},
    })));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      body: JSON.stringify({ refresh_token: "abandoned-refresh-token" }),
    })));
    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Посмотреть регистрацию" }));
    expect(within(flowDialog()).getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(within(flowDialog()).queryByLabelText("Пароль")).not.toBeInTheDocument();
  });

  it("hands data management to a single page dialog and returns focus to resume", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    await confirmIntent(user);
    const dialog = expectOneFlowDialog();
    await user.click(within(dialog).getByRole("button", { name: "Управление данными" }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(document.querySelectorAll("dialog[open], [aria-modal='true']")).toHaveLength(1);
    const deletion = screen.getByRole("dialog", { name: "Удаление аккаунта и данных" });
    expect(deletion.closest(".registration-flow-dialog")).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Посмотреть регистрацию" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Посмотреть регистрацию" }));
    expectOneFlowDialog();
    expect(within(flowDialog()).getByRole("button", { name: "Управление данными" })).toBeInTheDocument();
  });

  it("completes the without-password flow without creating a web session", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    await confirmIntent(user);
    expect(await screen.findByRole("heading", { name: "Регистрация успешно сохранена" })).toBeInTheDocument();
    expect(screen.getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(screen.getByText(/Код подтверждения был отправлен.*Пароль и web-сессия не создавались/)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Оформление регистрации" })).getByText("Мероприятие").closest("div")).toHaveTextContent("Шаббат для друзей");
    expect(within(flowDialog()).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText(REGISTRATION_ID)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/me/registrations")))
      .toBe(false);
  });

  it("deletes passwordless registration data through the current verified email without creating account auth", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const user = await setupValidForm();
    const initialUrl = window.location.href;
    await createIntent(user);
    await confirmIntent(user);
    expect(await screen.findByRole("button", { name: "Управление данными" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Мои билеты" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Пароль")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Управление данными" }));
    const email = screen.getByLabelText("Email для подтверждения удаления");
    expect(email).toHaveValue("anna@example.ru");
    expect(email).toHaveAttribute("readonly");
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(envelope({ accepted: true }), 202))
      .mockImplementationOnce(() => response(privacySession()))
      .mockImplementationOnce(() => response(deletionPrivacyRequest(), 201))
      .mockImplementationOnce(() => response(deletionPendingLifecycle()));
    await user.click(screen.getByRole("button", { name: "Получить код подтверждения" }));
    await user.type(screen.getByLabelText("Код подтверждения удаления"), "123456");
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.click(screen.getByRole("button", { name: "Перейти к удалению аккаунта" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить аккаунт" }));

    expect(await screen.findByRole("heading", { name: "Запрос на удаление подтверждён" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Аккаунт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Мои билеты" })).not.toBeInTheDocument();
    const privacyAccessRequest = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/privacy/access/request"));
    expect(privacyAccessRequest?.[1]?.body).toBe(JSON.stringify({ email: "anna@example.ru" }));
    expect(privacyAccessRequest?.[1]?.headers).not.toHaveProperty("Authorization");
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/auth/me"))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("/me/registrations"))).toBe(false);
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(initialUrl);
    expect(window.location.href).not.toContain("privacy-session-token");
    expect(window.location.href).not.toContain(PRIVACY_REQUEST_ID);
    expect(window.location.href).not.toContain("123456");

    await user.click(screen.getByRole("button", { name: "Вернуться к регистрации" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Управление данными" })).not.toBeInTheDocument();
    expect(screen.getByText(/Запрос на удаление подтверждён.*Доступ остановлен/)).toBeInTheDocument();
  });

  it("claims the same registration through the direct set-password handoff", async () => {
    const user = await setupValidForm();
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "set_password"));
    const password = screen.getByLabelText("Новый пароль");
    const repeat = screen.getByLabelText("Повтор нового пароля");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(repeat).toHaveAttribute("autocomplete", "new-password");
    await user.type(password, "strong-pass-123");
    await user.type(repeat, "strong-pass-123");
    vi.mocked(fetch).mockImplementationOnce(() => response({ ok: true }));
    await user.click(screen.getByRole("button", { name: "Задать пароль" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Аккаунт создан для этой же регистрации");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body).toEqual({ code: SET_PASSWORD_CODE, new_password: "strong-pass-123" });
    expect(window.location.href).not.toContain(SET_PASSWORD_CODE);
    expect(window.location.href).not.toContain("strong-pass-123");
    expect(screen.queryByRole("button", { name: "Мои билеты" })).not.toBeInTheDocument();
  });

  it("shows the neutral sign-in next step without forcing authentication", async () => {
    const user = await setupValidForm();
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "sign_in"));
    expect(await screen.findByText("Регистрация уже сохранена. Вход необязателен: войти с существующим паролем для управления аккаунтом можно позже.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Новый пароль")).not.toBeInTheDocument();
  });

  it("requests and confirms a set-password code after a replay", async () => {
    const user = await setupValidForm();
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "request_set_password"));
    vi.mocked(fetch).mockImplementationOnce(() => response({ ok: true }));
    await user.click(await screen.findByRole("button", { name: "Запросить код задания пароля" }));
    const code = await screen.findByLabelText("Код из письма");
    expect(code).toHaveFocus();
    await user.type(code, "emailed-set-password-code");
    await user.type(screen.getByLabelText("Новый пароль"), "strong-pass-123");
    await user.type(screen.getByLabelText("Повтор нового пароля"), "strong-pass-123");
    vi.mocked(fetch).mockImplementationOnce(() => response({ ok: true }));
    await user.click(screen.getByRole("button", { name: "Задать пароль" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Аккаунт создан для этой же регистрации");
    const authCalls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes("/auth/"));
    expect(authCalls.map(([input]) => String(input))).toEqual([
      "/api/auth/request-set-password",
      "/api/auth/confirm-set-password",
    ]);
  });

  it("submits occurrence, seats, and only selected option quantities", async () => {
    const data = responseWithOccurrences();
    data.participation_options[0].allow_quantity = true;
    data.participation_options[0].max_quantity = 4;
    const user = await setupValidForm(data, `?occurrence=${OCCURRENCE_TWO_ID}`);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Основное участие" }));
    await user.click(screen.getByRole("button", { name: "Увеличить количество: Основное участие" }));
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(body).toMatchObject({
      occurrence_id: OCCURRENCE_TWO_ID,
      seats_count: 3,
      option_selections: [{ option_id: OPTION_ID, quantity: 3 }],
    });
    const result = registrationResult("confirmed", "none", OCCURRENCE_TWO_ID);
    result.data.registration.seats_count = 3;
    await confirmIntent(user, result);
    expect(await screen.findByText("Выбранная дата")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "Оформление регистрации" })).getByText("3")).toBeInTheDocument();
  });

  it("reuses an idempotency key after a network failure and rotates it after payload changes", async () => {
    const user = await setupValidForm();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    await screen.findByRole("alert");
    const firstBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body));
    expect(retryBody.idempotency_key).toBe(firstBody.idempotency_key);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "2" } });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const changedBody = JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body));
    expect(changedBody.idempotency_key).not.toBe(firstBody.idempotency_key);
  });

  it("blocks a double click while intent creation is in flight", async () => {
    const user = await setupValidForm();
    let resolvePost!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
    const button = screen.getByRole("button", { name: "Записаться на мероприятие" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(2);
    resolvePost(await response(intentCreated(), 201));
    expect(await screen.findByLabelText("Код подтверждения")).toHaveFocus();
  });

  it("accepts exactly six digits and keeps the field editable after an invalid code", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    const code = screen.getByLabelText("Код подтверждения");
    fireEvent.change(code, { target: { value: "12a34567" } });
    expect(code).toHaveValue("123456");
    vi.mocked(fetch).mockImplementationOnce(() => response({ data: null, error: { code: "invalid_verification_code", message: "unsafe" }, meta: {} }, 400));
    await user.click(screen.getByRole("button", { name: "Подтвердить email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Код неверный или истёк");
    expect(code).toHaveFocus();
    expect(code).toBeEnabled();
  });

  it("resends only on demand, clears the old code, and handles Retry-After cooldown", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    await user.type(screen.getByLabelText("Код подтверждения"), "123456");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope({ next_step: "confirm_email", expires_at: EXPIRES_AT })));
    await user.click(screen.getByRole("button", { name: "Отправить код повторно" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Новый код отправлен");
    expect(screen.getByLabelText("Код подтверждения")).toHaveValue("");

    vi.mocked(fetch).mockImplementationOnce(() => response({ data: null, error: { code: "resend_cooldown", message: "technical" }, meta: {} }, 429, { "Retry-After": "9" }));
    await user.click(screen.getByRole("button", { name: "Отправить код повторно" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("немного позже");
    expect(screen.getByRole("button", { name: /Повторная отправка через/ })).toBeDisabled();
  });

  it("uses status after create returns completed", async () => {
    const user = await setupValidForm();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(intentCreated("completed"), 201))
      .mockImplementationOnce(() => response(envelope({
        state: "confirmed",
        expires_at: null,
        registration: {
          id: REGISTRATION_ID,
          event_id: EVENT_ID,
          occurrence_id: null,
          status: "confirmed",
          seats_count: 1,
          payment_status: "not_required",
          total_amount: 0,
          total_currency: "RUB",
        },
        account_next_step: "none",
      })));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(await screen.findByRole("heading", { name: "Регистрация успешно сохранена" })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe(`/api/web/registration-intents/${FLOW_ID}/status`);
  });

  it("recovers an ambiguous confirmation through the explicit status action", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("connection lost"));
    await user.type(screen.getByLabelText("Код подтверждения"), "123456");
    await user.click(screen.getByRole("button", { name: "Подтвердить email" }));
    expect(await screen.findByRole("button", { name: "Проверить статус" })).toBeInTheDocument();
    vi.mocked(fetch).mockImplementationOnce(() => response(envelope({
      state: "confirmed",
      expires_at: null,
      registration: {
        id: REGISTRATION_ID,
        event_id: EVENT_ID,
        occurrence_id: null,
        status: "pending",
        seats_count: 1,
        payment_status: "not_required",
        total_amount: 0,
        total_currency: "RUB",
      },
      account_next_step: "none",
    })));
    await user.click(screen.getByRole("button", { name: "Проверить статус" }));
    expect(await screen.findByText(/ожидает подтверждения организатора/)).toBeInTheDocument();
  });

  it("shows an expired-flow state returned by status without polling", async () => {
    const user = await setupValidForm();
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(intentCreated("completed"), 201))
      .mockImplementationOnce(() => response(envelope({ state: "not_available", expires_at: null, registration: null, account_next_step: null })));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("истёк или регистрация недоступна");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["confirmed", "Регистрация подтверждена."],
    ["pending", "ожидает подтверждения организатора"],
    ["waitlisted", "лист ожидания"],
  ] as const)("distinguishes the %s success result", async (status, copy) => {
    const user = await setupValidForm();
    await createIntent(user);
    await confirmIntent(user, registrationResult(status));
    expect(await screen.findByText(new RegExp(copy))).toBeInTheDocument();
  });

  it("shows the server-authoritative pending paid result without payment claims or CTA", async () => {
    const user = userEvent.setup();
    await renderEvent(paidEventResponse());
    await user.click(screen.getByRole("radio", { name: /Платное участие/ }));
    await user.type(screen.getByLabelText("Имя"), "Анна");
    await user.type(screen.getByLabelText("Фамилия"), "Иванова");
    await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
    await user.type(screen.getByLabelText("Email"), "anna@example.ru");
    await user.click(screen.getByLabelText(/Я ознакомился/));
    await createIntent(user);
    await confirmIntent(
      user,
      registrationResult("pending", "none", null, "pending", 4321, "RUB"),
    );

    expect(await screen.findByRole("heading", { name: "Заявка создана" })).toBeInTheDocument();
    expect(screen.getByText("Заявка создана.")).toBeInTheDocument();
    expect(screen.getByText("Сумма").closest("div")).toHaveTextContent(/4.?321.?₽/);
    expect(screen.getByText("Оплата на сайте пока не выполнена.")).toBeInTheDocument();
    expectOneFlowDialog();
    expect(within(flowDialog()).getByText("Онлайн-оплата пока недоступна.")).toBeInTheDocument();
    expect(within(flowDialog()).getByLabelText("Этапы регистрации")).toHaveTextContent("Ожидается");
    expect(within(flowDialog()).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(flowDialog()).queryByText(/СБП|Банковская карта|Демо/)).not.toBeInTheDocument();
    expect(screen.getByText(/Статус оплаты:/)).toHaveTextContent("ожидается");
    expect(screen.queryByRole("button", { name: /Оплатить/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Оплата прошла|Оплачено|Платёж выполнен|Тестовая оплата/)).not.toBeInTheDocument();
  });

  it.each([
    ["identity_confirmation_unavailable", 409, "Не удалось автоматически подтвердить данные"],
    ["registration_unavailable", 404, "Регистрация на мероприятие стала недоступна"],
    ["state_conflict", 409, "Окно регистрации закрыто"],
    ["capacity_unavailable", 409, "Свободных мест больше нет"],
    ["email_delivery_unavailable", 503, "Отправка email временно недоступна"],
  ] as const)("maps %s to a safe Russian error", async (code, status, safeCopy) => {
    const user = await setupValidForm();
    vi.mocked(fetch).mockImplementationOnce(() => response({
      data: null,
      error: { code, message: "email already exists; phone belongs to user 123" },
      meta: {},
    }, status));
    await user.click(screen.getByRole("button", { name: "Записаться на мероприятие" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(safeCopy);
    expect(alert).not.toHaveTextContent("email already exists");
    expect(alert).not.toHaveTextContent("phone belongs");
  });

  it("keeps credentials and PII out of storage and URL while preserving keyboard focus order", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const initialCookie = document.cookie;
    const user = await setupValidForm();
    const originalUrl = window.location.href;
    await createIntent(user);
    const code = screen.getByLabelText("Код подтверждения");
    expect(code).toHaveFocus();
    await user.type(code, "123456");
    await user.tab();
    expect(screen.getByRole("button", { name: "Подтвердить email" })).toHaveFocus();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(document.cookie).toBe(initialCookie);
    expect(window.location.href).toBe(originalUrl);
    expect(window.location.href).not.toContain(FLOW_ID);
    expect(window.location.href).not.toContain("123456");
  });
});
