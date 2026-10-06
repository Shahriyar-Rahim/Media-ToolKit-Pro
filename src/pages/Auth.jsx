import React, { useState } from "react";
import { call } from "../lib/api.js";
import { Card, Field, Btn, Msg, useAction } from "../components/ui.jsx";

// One small state machine for every sign-in related screen.
export default function Auth({ start = "login", goto, onAuthed }) {
  const [mode, setMode] = useState(start);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const a = useAction();
  const titles = {
    login: "Log in",
    register: "Create your account",
    verify: "Verify your email",
    loginOtp: "Enter your sign-in code",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "register") {
      if (
        await a.run(() =>
          call("POST", "/api/auth/register", {
            email,
            password,
            confirmPassword: confirm,
            name: name || undefined,
          }),
        )
      ) {
        setMode("verify");
        a.setOk("We sent a 6-digit code to your email.");
      }
    } else if (mode === "verify") {
      if (
        await a.run(() =>
          call("POST", "/api/auth/verify-email", { email, code }),
        )
      ) {
        setMode("login");
        setCode("");
        a.setOk("Email verified. You can log in now.");
      }
    } else if (mode === "login") {
      try {
        a.setErr("");
        const r = await call("POST", "/api/auth/login", { email, password });
        if (r.otpRequired) {
          setMode("loginOtp");
          a.setOk("We emailed you a sign-in code.");
        } else await onAuthed();
      } catch (er) {
        if (er.code === "EMAIL_NOT_VERIFIED") {
          setMode("verify");
          a.setOk("Please verify your email. We sent a new code.");
        } else if (er.code === "PASSWORD_RESET_REQUIRED") {
          setMode("reset");
          setPassword("");
          a.setOk(
            "For your security you need a new password. We emailed you a code.",
          );
        } else a.setErr(er.message);
      }
    } else if (mode === "loginOtp") {
      if (
        await a.run(() => call("POST", "/api/auth/login/otp", { email, code }))
      )
        await onAuthed();
    } else if (mode === "forgot") {
      if (
        await a.run(() => call("POST", "/api/auth/forgot-password", { email }))
      ) {
        setMode("reset");
        a.setOk("If that email has an account, a code is on its way.");
      }
    } else if (mode === "reset") {
      if (
        await a.run(() =>
          call("POST", "/api/auth/reset-password", { email, code, password }),
        )
      ) {
        setMode("login");
        setPassword("");
        setCode("");
        a.setOk("Password changed. Log in with your new password.");
      }
    }
  };
  const needsCode = ["verify", "loginOtp", "reset"].includes(mode),
    needsPw = ["login", "register", "reset"].includes(mode);
  return (
    <div className="max-w-md mx-auto py-12 px-6">
      <button className="btn mb-4" onClick={() => goto("landing")}>
        ← Back
      </button>
      <Card title={titles[mode]}>
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field label="Email">
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={mode === "loginOtp"}
            />
          </Field>
          {mode === "register" && (
            <Field label="Name (optional)">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </Field>
          )}
          {needsPw && (
            <Field
              label={mode === "reset" ? "New password" : "Password"}
              hint={
                mode !== "login"
                  ? "At least 10 characters, with letters and numbers."
                  : undefined
              }
            >
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          )}
          {mode === "register" && (
            <Field label="Confirm password">
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </Field>
          )}
          {needsCode && (
            <Field label="6-digit code">
              <input
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </Field>
          )}
          <Msg>{a.err}</Msg>
          <Msg kind="ok">{a.ok}</Msg>
          <Btn primary type="submit" disabled={a.busy}>
            {a.busy ? "Please wait…" : titles[mode]}
          </Btn>
        </form>
        <div className="flex flex-wrap gap-3 mt-4 text-sm">
          {mode === "login" && (
            <>
              <button className="btn" onClick={() => setMode("register")}>
                Create account
              </button>
              <button className="btn" onClick={() => setMode("forgot")}>
                Forgot password
              </button>
            </>
          )}
          {mode === "register" && (
            <button className="btn" onClick={() => setMode("login")}>
              I already have an account
            </button>
          )}
          {mode === "verify" && (
            <button
              className="btn"
              disabled={!email}
              onClick={() =>
                a.run(
                  () =>
                    call("POST", "/api/auth/resend-verification", { email }),
                  "A new code was sent if one is allowed right now.",
                )
              }
            >
              Resend code
            </button>
          )}
          {(mode === "forgot" || mode === "reset" || mode === "loginOtp") && (
            <button className="btn" onClick={() => setMode("login")}>
              Back to log in
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
