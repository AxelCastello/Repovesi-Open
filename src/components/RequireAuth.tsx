import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import useAuthSession from "../lib/useAuthSession";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuthSession();

  if (loading) return <div className="container">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

