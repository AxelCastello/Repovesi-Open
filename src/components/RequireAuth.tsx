import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import useAuthSession from "../lib/useAuthSession";
import useAutoJoinCompetitions from "../lib/useAutoJoinCompetitions";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuthSession();
  
  // Auto-join user to active competitions they're whitelisted for
  useAutoJoinCompetitions();

  if (loading) return <div className="container">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

