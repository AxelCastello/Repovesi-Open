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
        const errorMsg = signInError.message || "";
        
        // If account already exists, don't try to sign up again
        if (errorMsg.includes("Invalid login credentials")) {
          setStatus("Invalid username or password. Check your username spelling.");
          setBusy(false);
          return;
        }
        
        // Try to sign up if user doesn't exist yet
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
        
        if (signUpError) {
          if (signUpError.message.includes("already")) {
            setStatus("Account exists. Try signing in again, or refresh the page and retry.");
          } else {
            throw signUpError;
          }
        } else {
          setStatus("Account created. You should now be able to sign in again.");
        }
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
      <h1 style={{ marginTop: 0 }}>Kirjaudu sisään</h1>
      <div className="field">
        <label>
          Käyttäjänimi
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="words"
            spellCheck={false}
            placeholder="Matti M"
          />
        </label>
        <div className="row">
          <button disabled={busy || normalized.length < 3} onClick={onSignIn}>
            {busy ? "Ladataan..." : "Kirjaudu sisään"}
          </button>
        </div>

      <p className="muted" style={{ marginBottom: 0 }}>
        Anna nimi, joka vastaa sallittujen pelaajien luetteloa. Salasanaa ei tarvitse antaa.
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        If you're having trouble signing in, contact an admin or try using the password reset feature in your email provider.
      </p>
        {status ? <div className="muted">{status}</div> : null}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        After signing in, an admin must add your account to the competition whitelist if it is not already.
      </p>
    </div>
  );
}

