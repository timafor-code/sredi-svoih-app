import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  responseWithOccurrences,
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
const EXPIRES_AT = "2026-09-12T18:00:00+03:00";
const SET_PASSWORD_CODE = "opaque-set-password-code-with-sufficient-length";

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
) {
  return envelope({
    intent_status: "confirmed",
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT_ID,
      occurrence_id: occurrenceId,
      status,
      seats_count: 1,
    },
    account_next_step: accountNextStep,
    set_password_code: accountNextStep === "set_password" ? SET_PASSWORD_CODE : null,
    set_password_expires_at: accountNextStep === "set_password" ? EXPIRES_AT : null,
  });
}

function successfulFetch(data = eventResponse()) {
  vi.mocked(fetch).mockImplementation(() => response({ data, error: null, meta: {} }));
}

async function renderEvent(data = eventResponse(), search = "", pathValue = EVENT_ID) {
  successfulFetch(data);
  window.history.replaceState(null, "", `/events/${pathValue}${search}`);
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: data.event.title });
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
  choice: "Продолжить без пароля" | "Создать аккаунт" = "Продолжить без пароля",
) {
  vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
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

  it("requires a date first and hides the participation and personal flow", async () => {
    const data = responseWithQuestionnaire();
    const occurrenceData = responseWithOccurrences();
    data.registration_state = occurrenceData.registration_state;
    data.occurrence_selection_mode = "user_select";
    data.default_occurrence_id = null;
    data.occurrences = occurrenceData.occurrences;
    await renderEvent(data);

    expect(
      screen.getAllByRole<HTMLInputElement>("radio", { name: /Пятница|Суббота/ })
        .every((radio) => !radio.checked),
    ).toBe(true);
    expect(screen.getByText("Сначала выберите дату участия")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Варианты участия" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Количество мест" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Дополнительные вопросы" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Я ознакомился/)).not.toBeInTheDocument();
  });

  it("preselects a returned occurrence from the query and uses its state", async () => {
    await renderEvent(responseWithOccurrences(), `?occurrence=${OCCURRENCE_TWO_ID}`);
    expect(screen.getByRole("radio", { name: /Суббота/ })).toBeChecked();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(window.location.search).toBe(`?occurrence=${OCCURRENCE_TWO_ID}`);
  });

  it("ignores an occurrence outside the returned list", async () => {
    await renderEvent(responseWithOccurrences(), "?occurrence=77777777-7777-4777-8777-777777777777");
    expect(screen.getByRole("radio", { name: /Пятница/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Суббота/ })).not.toBeChecked();
    expect(screen.getByText("Сначала выберите дату участия")).toBeInTheDocument();
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
    await renderEvent(responseWithOccurrences(), "?source=invite");
    await user.click(screen.getByRole("radio", { name: /Суббота/ }));
    expect(window.location.pathname).toBe(`/events/${PUBLIC_SLUG}`);
    expect(window.location.search).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lets a selected occurrence override the aggregate state", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithOccurrences());
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Суббота/ }));
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Пятница/ }));
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
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

describe("local form shell", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("shows linked accessible errors and focuses the first invalid field", async () => {
    await renderEvent();
    await userEvent.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Введите телефон.")).toHaveAttribute("id", "phone-error");
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
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
    const optionQuantity = screen.getByLabelText("Количество: Основное участие");
    await userEvent.click(screen.getByRole("checkbox", { name: /Основное участие/ }));
    fireEvent.change(optionQuantity, { target: { value: "3" } });
    expect(optionQuantity).toHaveValue(3);
    expect(seatsCount).toHaveValue(1);
    fireEvent.change(seatsCount, { target: { value: "1000" } });
    expect(seatsCount).toHaveValue(1000);
    expect(optionQuantity).toHaveValue(3);
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

  it("presents three account actions without account-choice radios or a generic continue button", async () => {
    await renderEvent();
    const withoutPassword = screen.getByRole("button", { name: "Продолжить без пароля" });
    const createAccount = screen.getByRole("button", { name: "Создать аккаунт" });
    expect(screen.queryByRole("radio", { name: /Продолжить без пароля/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Создать аккаунт/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Продолжить$/ })).not.toBeInTheDocument();
    expect(withoutPassword).toHaveAttribute("aria-pressed", "false");
    expect(createAccount).toHaveAttribute("aria-pressed", "false");
    expect(withoutPassword).toHaveClass("primary-button");
    expect(createAccount).toHaveClass("secondary-button");
    expect(screen.getByRole("button", { name: "У меня уже есть аккаунт" })).toBeInTheDocument();
    expect(screen.getByText(/^Подтвердите email и запишитесь/)).toBeInTheDocument();
    expect(screen.getByText(/^Задайте пароль один раз/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Согласие на регистрацию/ })).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link", { name: /Политика конфиденциальности/ })[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/маркетинг/i)).not.toBeInTheDocument();
  });

  it.each([
    ["Продолжить без пароля", "without_password", "Создать аккаунт"],
    ["Создать аккаунт", "create_account", "Продолжить без пароля"],
  ] as const)("uses shared validation and selects %s as %s", async (buttonName, _choice, otherButtonName) => {
    await renderEvent();
    const action = screen.getByRole("button", { name: buttonName });
    await userEvent.click(action);
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Телефон")).toHaveAttribute("aria-invalid", "true");
    expect(action).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: otherButtonName })).toHaveAttribute("aria-pressed", "false");
  });

  it.each(["Продолжить без пароля", "Создать аккаунт"])("requires consent for %s", async (buttonName) => {
    const user = userEvent.setup();
    await renderEvent();
    expect(screen.getByLabelText(/Я ознакомился/)).not.toBeChecked();
    await fillValidForm(user, { consent: false });
    await user.click(screen.getByRole("button", { name: buttonName }));
    expect(screen.getByLabelText(/Я ознакомился/)).toHaveFocus();
    expect(screen.getByText("Подтвердите согласие для продолжения.")).toBeInTheDocument();
    expect(screen.queryByText(/Форма заполнена/)).not.toBeInTheDocument();
  });

  it("shows and enforces the returned quantity boundaries", async () => {
    const data = eventResponse();
    data.participation_options[0].allow_quantity = true;
    data.participation_options[0].min_quantity = 2;
    data.participation_options[0].max_quantity = 4;
    await renderEvent(data);

    const quantity = screen.getByLabelText("Количество: Основное участие");
    expect(quantity).toHaveAttribute("min", "2");
    expect(quantity).toHaveAttribute("max", "4");
    expect(quantity).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Основное участие/ }));
    expect(quantity).toBeEnabled();
    fireEvent.change(quantity, { target: { value: "9" } });
    expect(quantity).toHaveValue(4);
  });

  it("shows a neutral notice for the existing-account action", async () => {
    await renderEvent();
    const initialUrl = window.location.href;
    await userEvent.click(screen.getByRole("button", { name: "У меня уже есть аккаунт" }));
    expect(screen.getByRole("status")).toHaveTextContent("Можно продолжить регистрацию через подтверждение email");
    expect(screen.getByRole("status")).toHaveTextContent("не будут молча перезаписаны");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe(initialUrl);
  });

  it.each([
    ["Продолжить без пароля", "without_password"],
    ["Создать аккаунт", "create_account"],
  ] as const)("normalizes names and submits %s through the shared intent flow", async (buttonName, accountChoice) => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
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
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    expect(screen.getByLabelText(/Код встречи/)).toHaveFocus();
    expect(document.getElementById(`questionnaire-${QUESTION_IDS.short}-error`)).toHaveTextContent(
      "Ответьте на обязательный вопрос.",
    );

    await fillValidQuestionnaire(user);
    await user.click(screen.getByRole("checkbox", { name: "Вторая" }));
    await user.click(screen.getByRole("checkbox", { name: "Третья" }));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    expect(screen.getByRole("checkbox", { name: "Первая" })).toHaveFocus();
    expect(screen.getByText("Выберите не более 2 вариантов.")).toBeInTheDocument();
  });

  it("submits the exact questionnaire version and only field IDs plus normalized values", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithQuestionnaire());
    await fillValidForm(user);
    await fillValidQuestionnaire(user);
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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

  it("completes the without-password flow without creating a web session", async () => {
    const user = await setupValidForm();
    await createIntent(user);
    await confirmIntent(user);
    expect(await screen.findByRole("heading", { name: "Регистрация успешно сохранена" })).toBeInTheDocument();
    expect(screen.getByText("Регистрация подтверждена.")).toBeInTheDocument();
    expect(screen.getByText(/Код подтверждения был отправлен.*Пароль и web-сессия не создавались/)).toBeInTheDocument();
    expect(screen.getAllByText("Шаббат для друзей")).toHaveLength(2);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText(REGISTRATION_ID)).not.toBeInTheDocument();
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
  });

  it("shows the neutral sign-in next step without forcing authentication", async () => {
    const user = await setupValidForm();
    await createIntent(user, "Создать аккаунт");
    await confirmIntent(user, registrationResult("confirmed", "sign_in"));
    expect(await screen.findByText("Регистрация сохранена. Для управления аккаунтом можно войти с существующим паролем.")).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Количество: Основное участие"), { target: { value: "3" } });
    vi.mocked(fetch).mockImplementationOnce(() => response(intentCreated(), 201));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("reuses an idempotency key after a network failure and rotates it after payload changes", async () => {
    const user = await setupValidForm();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    await screen.findByRole("alert");
    const firstBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body));
    expect(retryBody.idempotency_key).toBe(firstBody.idempotency_key);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Количество мест" }), { target: { value: "2" } });
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const changedBody = JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body));
    expect(changedBody.idempotency_key).not.toBe(firstBody.idempotency_key);
  });

  it("blocks a double click while intent creation is in flight", async () => {
    const user = await setupValidForm();
    let resolvePost!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));
    const button = screen.getByRole("button", { name: "Продолжить без пароля" });
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
        registration: { id: REGISTRATION_ID, event_id: EVENT_ID, occurrence_id: null, status: "confirmed", seats_count: 1 },
        account_next_step: "none",
      })));
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
      registration: { id: REGISTRATION_ID, event_id: EVENT_ID, occurrence_id: null, status: "pending", seats_count: 1 },
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
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
    await user.click(screen.getByRole("button", { name: "Продолжить без пароля" }));
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
