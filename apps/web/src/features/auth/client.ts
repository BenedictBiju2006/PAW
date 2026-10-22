import { api } from "../../shared/http/api";
export type SessionUser = { id: string; email: string };
export function getSession() {
  return api<{ user: SessionUser | null }>("auth/session");
}
export function signOut() {
  return api("auth/signout", "POST", {});
}
export function authenticate(signup: boolean, form: FormData) {
  return api<{ authenticated: boolean; message: string }>(
    `auth/${signup ? "signup" : "signin"}`,
    "POST",
    { email: form.get("email"), password: form.get("password") },
  );
}

export { AccountDialog } from "./components/AccountDialog";
export { AuthScreen } from "./components/AuthScreen";
