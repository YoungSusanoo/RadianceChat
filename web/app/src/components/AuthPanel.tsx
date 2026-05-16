import type { FormEvent } from "react";
import type { User } from "../lib/types";

type Props = {
  mode: "login" | "register";
  user: User | null;
  busy: boolean;
  onModeChange: (mode: "login" | "register") => void;
  onSubmit: (payload: { name: string; email: string; password: string }) => void;
  onLogout: () => void;
};

export function AuthPanel({ mode, user, busy, onModeChange, onSubmit, onLogout }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || "")
    });
  }

  if (user) {
    return (
      <section className="surface">
        <div className="profile-line">
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <button className="button quiet" type="button" onClick={onLogout} disabled={busy}>
            Выйти
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="surface">
      <div className="switch">
        <button className={mode === "login" ? "active" : ""} type="button" onClick={() => onModeChange("login")}>
          Вход
        </button>
        <button className={mode === "register" ? "active" : ""} type="button" onClick={() => onModeChange("register")}>
          Регистрация
        </button>
      </div>

      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && (
          <label>
            Имя
            <input name="name" autoComplete="name" placeholder="Анна" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" autoComplete="email" placeholder="anna@example.com" required />
        </label>
        <label>
          Пароль
          <input name="password" type="password" autoComplete="current-password" placeholder="Минимум 4 символа" required />
        </label>
        <button className="button primary" type="submit" disabled={busy}>
          {mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
      </form>
    </section>
  );
}

