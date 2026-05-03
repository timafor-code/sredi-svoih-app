const futureSections = [
  "Обзор",
  "События",
  "Импорт с сайта",
  "Регистрации",
  "Участники",
  "Приглашения",
  "Настройки",
];

export function OverviewPage() {
  return (
    <div className="overview">
      <div className="overview__eyebrow">Bootstrap web-admin</div>

      <header className="overview__header">
        <h1>Среди Своих · Admin Center</h1>
        <p>
          Web-админка будет реализована по прототипу{" "}
          <span>docs/prototype/admin-events-center.html</span>
        </p>
      </header>

      <div className="overview__reference" aria-label="Путь к HTML-прототипу">
        <span>Открыть HTML-прототип</span>
        <code>docs/prototype/admin-events-center.html</code>
      </div>

      <section className="overview__sections" aria-labelledby="future-sections-title">
        <h2 id="future-sections-title">Будущие разделы</h2>
        <ul>
          {futureSections.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
