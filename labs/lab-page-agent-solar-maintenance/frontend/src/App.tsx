import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { Login } from "./routes/Login.js";
import { SiteDetail } from "./routes/SiteDetail.js";
import { Sites } from "./routes/Sites.js";

function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return session ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/sites" replace />} />
      <Route
        path="/sites"
        element={
          <RequireSession>
            <Sites />
          </RequireSession>
        }
      />
      <Route
        path="/sites/:id"
        element={
          <RequireSession>
            <SiteDetail />
          </RequireSession>
        }
      />
    </Routes>
  );
}
