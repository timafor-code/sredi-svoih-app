import { useState, type FormEvent } from "react";

import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { useAdminAuth } from "../store/useAdminAuth";

export function LoginPage() {
  const { error: authError, loading, signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    try {
      await signIn(email, password);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Не удалось войти.");
    }
  };

  const error = localError ?? authError;

  return (
    <main className="auth-screen">
      <GlassCard className="login-card" elevated>
        <div className="auth-kicker">Admin Center</div>
        <h1>Среди Своих · Admin Center</h1>
        <p>Войдите как администратор или менеджер событий</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              autoComplete="email"
              disabled={loading}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              type="email"
              value={email}
            />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              autoComplete="current-password"
              disabled={loading}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              type="password"
              value={password}
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <Button disabled={loading} type="submit" variant="primary">
            {loading ? "Входим..." : "Войти"}
          </Button>
        </form>

        <div className="auth-helper">Доступ разрешён только admin и event_manager.</div>
      </GlassCard>
    </main>
  );
}
