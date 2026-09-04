import { useId, useRef, type ReactNode } from "react";

export type EventEditorTab = "event" | "tickets" | "web" | "period";

const tabs: Array<{ id: EventEditorTab; label: string }> = [
  { id: "event", label: "Событие" },
  { id: "tickets", label: "Билеты и места" },
  { id: "web", label: "Веб-страница" },
  { id: "period", label: "Период регистрации" },
];

export function EventEditorTabs({ activeTab, onTabChange, registrationMode, dirty, panels }: {
  activeTab: EventEditorTab;
  onTabChange: (tab: EventEditorTab) => void;
  registrationMode: string;
  dirty: Record<EventEditorTab, boolean>;
  panels: Record<EventEditorTab, ReactNode>;
}) {
  const id = useId();
  const buttons = useRef<Partial<Record<EventEditorTab, HTMLButtonElement | null>>>({});
  const enabled = (tab: EventEditorTab) => tab === "tickets" ? registrationMode === "internal_paid"
    : tab === "web" ? ["internal_free", "internal_paid"].includes(registrationMode) : true;
  const selected = enabled(activeTab) ? activeTab : "event";

  return <>
    <div className="event-editor-tabs" role="tablist" aria-label="Редактор события">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab"
        ref={(element) => { buttons.current[tab.id] = element; }}
        id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
        aria-selected={selected === tab.id} disabled={!enabled(tab.id)}
        tabIndex={selected === tab.id ? 0 : -1}
        onClick={() => onTabChange(tab.id)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const available = tabs.filter((item) => enabled(item.id));
          const index = available.findIndex((item) => item.id === tab.id);
          const next = event.key === "Home" ? available[0] : event.key === "End" ? available[available.length - 1]
            : available[(index + (event.key === "ArrowRight" ? 1 : -1) + available.length) % available.length];
          onTabChange(next.id);
          buttons.current[next.id]?.focus();
        }}>
        <span>{tab.label}</span>
        {dirty[tab.id] ? <span className="event-editor-dirty" role="img" aria-label="Есть несохранённые изменения" title="Есть несохранённые изменения">●</span> : null}
        {!enabled(tab.id) ? <small>не используется</small> : null}
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" className="event-editor-panel"
      id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-tab-${tab.id}`}
      hidden={selected !== tab.id} tabIndex={0}>
      {panels[tab.id]}
    </div>)}
  </>;
}
