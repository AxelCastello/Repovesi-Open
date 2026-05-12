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
      const { data: sessionData } = await supabase.auth.getSession();
      const currentEmail = sessionData.session?.user?.email;

      if (currentEmail === derivedEmail) {
        setStatus(`Olet jo kirjautunut sisään käyttäjällä ${displayName}.`);
        return;
      }

      if (currentEmail && currentEmail !== derivedEmail) {
        await supabase.auth.signOut();
      }

      const signIn = async () => {
        const { error } = await supabase.auth.signInWithPassword({
          email: derivedEmail,
          password: derivedPassword,
        });
        return error;
      };

      let signInError = await signIn();

      if (signInError) {
        const errorMsg = signInError.message || "";

        if (errorMsg.includes("Invalid login credentials")) {
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
              await supabase.auth.signOut();
              signInError = await signIn();
              if (!signInError) {
                setStatus("Signed in.");
                return;
              }
              setStatus("Account exists but credentials are invalid. Check your username spelling or contact an admin.");
              return;
            }
            throw signUpError;
          }

          setStatus("Account created. You should now be able to sign in again.");
          return;
        }

        setStatus("Invalid username or password. Check your username spelling.");
        return;
      }

      setStatus("Signed in.");
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

      {normalized && (
        <div className="muted" style={{ fontSize: 11, marginTop: 12, padding: 8, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 4 }}>
          <strong>Debug:</strong> Email: {derivedEmail}
        </div>
      )}
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

