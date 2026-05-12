import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  const displayName = username.trim();
  const normalized = normalizeUsername(displayName);
  const derivedEmail = normalized ? usernameToEmail(displayName) : "";
  const derivedPassword = normalized ? usernameToPassword(displayName) : "";

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const currentEmail = data.session?.user?.email ?? null;
      setSessionEmail(currentEmail);
      if (currentEmail) {
        navigate("/");
      }
    });

    return () => {
      mounted = false;
    };
  }, [navigate]);

  async function onSignIn() {
    if (!normalized) {
      setStatus("Anna kelvollinen käyttäjänimi.");
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const currentEmail = sessionData.session?.user?.email ?? null;

      if (currentEmail === derivedEmail) {
        setStatus(`Olet jo kirjautunut sisään käyttäjällä ${displayName}.`);
        return;
      }

      if (currentEmail && currentEmail !== derivedEmail) {
        await supabase.auth.signOut();
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: derivedEmail,
        password: derivedPassword,
      });

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
              setStatus(
                "Tälle käyttäjänimelle on jo tili, mutta generoitu salasana ei täsmää. " +
                  "Pyydä ylläpitäjää nollaamaan tilisi tai luomaan se uudelleen."
              );
              return;
            }
            throw signUpError;
          }

          setStatus("Tili luotu. Kirjaudu uudelleen.");
          return;
        }

        setStatus("Väärä käyttäjänimi tai salasana. Tarkista kirjoitusvirheet.");
        return;
      }

      setStatus("Kirjauduttu sisään.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Kirjautuminen epäonnistui.");
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
          <div><strong>Tunnistetiedot:</strong></div>
          <div>Email: {derivedEmail}</div>
          <div>Normitettu käyttäjä: {normalized}</div>
          <div>Sessiotili: {sessionEmail ?? "ei kirjautuneena"}</div>
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

