import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { Login } from "./routes/Login.js";

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
            <p>Sites go here.</p>
          </RequireSession>
        }
      />
    </Routes>
  );
}
