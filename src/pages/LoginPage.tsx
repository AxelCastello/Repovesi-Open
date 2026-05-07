import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  normalizeUsername,
  usernameToEmail,
  usernameToPassword,
} from "../lib/usernameAuth";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const displayName = username.trim();
  const normalized = normalizeUsername(displayName);
  const derivedEmail = normalized ? usernameToEmail(displayName) : "";
  const derivedPassword = normalized ? usernameToPassword(displayName) : "";

  async function onSignIn() {
    if (!normalized) {
      setStatus("Enter a valid username.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: derivedEmail,
        password: derivedPassword,
      });

      if (signInError) {
        const { error: signUpError } = await supabase.auth.signUp({
          email: derivedEmail,
          password: derivedPassword,
          options: {
            data: {
              full_name: displayName,
              username: normalized,
            },
          },
        });
        if (signUpError) throw signUpError;
        setStatus("Account created. You should now be able to sign in again.");
      } else {
        setStatus("Signed in.");
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to sign in");
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
        <div className="row">
          <button disabled={busy || normalized.length < 3} onClick={onSignIn}>
            {busy ? "Working..." : "Sign in"}
          </button>
        </div>

        <div className="muted" style={{ fontSize: 12 }}>
          Enter the name that matches the whitelist. You do not need to enter a password.
        </div>
        {status ? <div className="muted">{status}</div> : null}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        After signing in, an admin must add your account to the competition whitelist if it is not already.
      </p>
    </div>
  );
}

