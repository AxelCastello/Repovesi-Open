import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuthSession();
  const displayName =
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    (session?.user?.user_metadata?.username as string | undefined) ||
    session?.user?.email ||
    "Signed in";

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  return (
    <div>
      <div className="nav">
        <div className="row" style={{ gap: 16 }}>
          <Link to="/standings" className={location.pathname === "/standings" ? "active" : ""}>
            Standings
          </Link>
          <Link to="/bet" className={location.pathname === "/bet" ? "active" : ""}>
            Wager
          </Link>
          <Link to="/admin" className={location.pathname === "/admin" ? "active" : ""}>
            Admin
          </Link>
        </div>
        <div className="nav-right">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/gamlakarleby-crest.png" alt="Gamlakarleby crest" className="nav-crest" />
              <div className="nav-user">{displayName}</div>
            </div>
            {session ? (
              <button
                onClick={handleSignOut}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Kirjaudu ulos
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="container">{children}</div>
    </div>
  );
}
