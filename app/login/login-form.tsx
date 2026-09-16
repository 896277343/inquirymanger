"use client";
import { useActionState } from "react";
import { login } from "./actions";
export function LoginForm(){
  const [error, action, pending] = useActionState(login, undefined);
  return <form action={action}>
    {error && <div className="error">{error}</div>}
    <label className="field">账号<input name="username" required autoFocus /></label>
    <label className="field">密码<input name="password" type="password" required /></label>
    <button className="btn btn-primary full" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
  </form>
}
