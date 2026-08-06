import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./cloud/pages/Login";
import Dashboard from "./pages/Dashboard";
import Write from "./pages/Write";
import MyDocuments from "./pages/MyDocuments";
import Approval from "./pages/Approval";
import Payments from "./pages/Payments";
import Mail from "./pages/Mail";
import MailDetail from "./pages/MailDetail";
import Category from "./pages/Category";
import CategoryDetail from "./pages/CategoryDetail";
import Settings from "./pages/Settings";
import DocumentDetail from "./pages/DocumentDetail";
import NetworkStatusBanner from "./components/NetworkStatusBanner";

function App() {
  return (
    <BrowserRouter>
      <NetworkStatusBanner />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/write" element={<Write />} />
        <Route path="/documents" element={<MyDocuments />} />
        <Route path="/documents/:id" element={<DocumentDetail />} />
        <Route path="/approval" element={<Approval />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/mail" element={<Mail />} />
        <Route path="/mail/:id" element={<MailDetail />} />
        <Route path="/category" element={<Category />}/>
        <Route path="/category/:id" element={<CategoryDetail/>} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
