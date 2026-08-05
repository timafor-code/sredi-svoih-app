import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  EVENT_ID,
  OCCURRENCE_ONE_ID,
  OCCURRENCE_TWO_ID,
  eventResponse,
  responseWithOccurrences,
} from "./test/fixtures";

function response(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

function successfulFetch(data = eventResponse()) {
  vi.mocked(fetch).mockImplementation(() => response({ data, error: null, meta: {} }));
}

async function renderEvent(data = eventResponse(), search = "") {
  successfulFetch(data);
  window.history.replaceState(null, "", `/events/${EVENT_ID}${search}`);
  render(<App />);
  await screen.findByRole("heading", { level: 1, name: data.event.title });
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Имя"), "  Анна   Мария  ");
  await user.type(screen.getByLabelText("Фамилия"), "Иванова");
  await user.type(screen.getByLabelText("Телефон"), "+7 (999) 123-45-67");
  await user.type(screen.getByLabelText("Email"), "anna@example.ru");
  await user.click(screen.getByLabelText(/Основное участие/));
  await user.click(screen.getByLabelText(/Продолжить без пароля/));
  await user.click(screen.getByLabelText(/Я ознакомился/));
}

describe("public event page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders not found and makes no request for malformed and unknown routes", () => {
    for (const path of ["/events/not-a-uuid", "/events", "/login"]) {
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

  it("preselects a returned occurrence from the query and uses its state", async () => {
    await renderEvent(responseWithOccurrences(), `?occurrence=${OCCURRENCE_TWO_ID}`);
    expect(screen.getByRole("radio", { name: /Суббота/ })).toBeChecked();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("ignores an occurrence outside the returned list", async () => {
    await renderEvent(responseWithOccurrences(), "?occurrence=77777777-7777-4777-8777-777777777777");
    expect(screen.getByRole("radio", { name: /Пятница/ })).toBeChecked();
    expect(screen.queryByLabelText("Имя")).not.toBeInTheDocument();
  });

  it("updates only occurrence in the query without reloading", async () => {
    const user = userEvent.setup();
    await renderEvent(responseWithOccurrences(), "?source=invite");
    await user.click(screen.getByRole("radio", { name: /Суббота/ }));
    expect(window.location.pathname).toBe(`/events/${EVENT_ID}`);
    expect(new URLSearchParams(window.location.search).get("source")).toBe("invite");
    expect(new URLSearchParams(window.location.search).get("occurrence")).toBe(OCCURRENCE_TWO_ID);
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
});

describe("local form shell", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("shows linked accessible errors and focuses the first invalid field", async () => {
    await renderEvent();
    await userEvent.click(screen.getByRole("button", { name: /^Продолжить$/ }));
    expect(screen.getByRole("group", { name: "Варианты участия" })).toHaveFocus();
    expect(screen.getByLabelText("Имя")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Введите телефон.")).toHaveAttribute("id", "phone-error");
  });

  it("keeps consent unchecked and blocks continuation without it", async () => {
    const user = userEvent.setup();
    await renderEvent();
    expect(screen.getByLabelText(/Я ознакомился/)).not.toBeChecked();
    await fillValidForm(user);
    await user.click(screen.getByLabelText(/Я ознакомился/));
    await user.click(screen.getByRole("button", { name: /^Продолжить$/ }));
    expect(screen.getByText("Подтвердите согласие для продолжения.")).toBeInTheDocument();
    expect(screen.queryByText(/Форма заполнена/)).not.toBeInTheDocument();
  });

  it("presents equal account choices, legal links, and no marketing consent", async () => {
    await renderEvent();
    const withoutPassword = screen.getByLabelText(/Продолжить без пароля/);
    const createAccount = screen.getByLabelText(/Создать аккаунт/);
    expect(withoutPassword).not.toBeChecked();
    expect(createAccount).not.toBeChecked();
    expect(withoutPassword.closest("label")).toHaveClass("account-choice-card");
    expect(createAccount.closest("label")).toHaveClass("account-choice-card");
    expect(screen.getByRole("link", { name: /Согласие на регистрацию/ })).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link", { name: /Политика конфиденциальности/ })[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/маркетинг/i)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "У меня уже есть аккаунт" }));
    expect(screen.getByRole("status")).toHaveTextContent("Вход для существующего аккаунта будет подключён на следующем этапе.");
  });

  it("normalizes names locally and stops before any POST request", async () => {
    const user = userEvent.setup();
    await renderEvent();
    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: /^Продолжить$/ }));
    expect(screen.getByLabelText("Имя")).toHaveValue("Анна Мария");
    expect(screen.getByRole("status")).toHaveTextContent("Форма заполнена. Отправка кода подтверждения будет подключена на следующем этапе.");
    expect(screen.queryByText(/email отправлен|регистрация создана|место зарезервировано/i)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("does not persist or expose edited PII", async () => {
    const user = userEvent.setup();
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");
    await renderEvent();
    await user.type(screen.getByLabelText("Имя"), "Секретное Имя");
    await user.type(screen.getByLabelText("Email"), "secret@example.test");
    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).not.toContain("secret");
    expect(document.title).not.toContain("secret");
    expect(within(document.body).queryByText("secret@example.test")).not.toBeInTheDocument();
  });
});
