import { useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import StandingsPage from "./pages/StandingsPage";
import BetPage from "./pages/BetPage";
import AdminPage from "./pages/AdminPage";
import LoginPage from "./pages/LoginPage";
import RequireAuth from "./components/RequireAuth";
import useAuthSession from "./lib/useAuthSession";

export default function App() {
  const { session, loading } = useAuthSession();

  const authed = useMemo(() => !loading && !!session, [loading, session]);

  if (loading) {
    return <div className="container">Loading...</div>;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={authed ? <Navigate to="/standings" replace /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/login"
        element={authed ? <Navigate to="/standings" replace /> : <LoginPage />}
      />
      <Route
        path="/standings"
        element={
          <RequireAuth>
            <Layout>
              <StandingsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/bet"
        element={
          <RequireAuth>
            <Layout>
              <BetPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <Layout>
              <AdminPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

