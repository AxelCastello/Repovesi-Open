import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuthSession from "../lib/useAuthSession";

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { session } = useAuthSession();
  const displayName =
    (session?.user?.user_metadata?.full_name as string | undefined) ||
    (session?.user?.user_metadata?.username as string | undefined) ||
    session?.user?.email ||
    "Signed in";

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
          <img src="/gamlakarleby-crest.png" alt="Gamlakarleby crest" className="nav-crest" />
          <div className="nav-user">{displayName}</div>
        </div>
      </div>
      <div className="container">{children}</div>
    </div>
  );
}

