import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { normalizeUsername, usernameToEmail } from "../lib/usernameAuth";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const displayName = username.trim();
  const normalized = normalizeUsername(displayName);
  const derivedEmail = normalized ? usernameToEmail(displayName) : "";

  async function onSignInWithPassword() {
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: derivedEmail,
        password: pin,
      });
      if (error) throw error;
      setStatus("Signed in.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to sign in");
    } finally {
      setBusy(false);
    }
  }

  async function onSignUpWithPassword() {
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signUp({
        email: derivedEmail,
        password: pin,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            // Used for display in standings/admin pages.
            full_name: displayName,
            username: normalized,
          },
        },
      });
      if (error) throw error;
      setStatus("Account created. You can now sign in with the same username + PIN.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to sign up");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Sign in</h1>
      <div className="field">
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="words"
            spellCheck={false}
            placeholder="Anton S"
          />
        </label>
        <label>
          PIN
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            type="password"
            placeholder="4-8 digits"
            autoComplete="current-password"
            inputMode="numeric"
          />
        </label>
        <div className="row">
          <button
            disabled={busy || normalized.length < 3 || pin.length < 4}
            onClick={onSignInWithPassword}
          >
            {busy ? "Working..." : "Sign in"}
          </button>
          <button
            disabled={busy || normalized.length < 3 || pin.length < 4}
            onClick={onSignUpWithPassword}
          >
            {busy ? "Working..." : "Create account"}
          </button>
        </div>

        <div className="muted" style={{ fontSize: 12 }}>
          Enter your name + a 4–8 digit PIN. This is “passwordless” in practice (no email links), but
          still prevents impersonation.
        </div>
        {status ? <div className="muted">{status}</div> : null}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        After signing in, an admin must add your account to the competition whitelist.
      </p>
    </div>
  );
}

