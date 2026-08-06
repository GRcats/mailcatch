import { Navigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

export default function AdminRoute({ children }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/" replace />;
  let role;
  try {
    role = jwtDecode(token)?.role;
  } catch {
    localStorage.removeItem("token");
  }
  if (!role) return <Navigate to="/" replace />;
  return role === "admin" ? children : <Navigate to="/dashboard" replace />;
}
