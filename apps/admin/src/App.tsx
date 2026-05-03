import { AdminShell } from "./components/AdminShell";
import { OverviewPage } from "./pages/OverviewPage";

export default function App() {
  return (
    <AdminShell>
      <OverviewPage />
    </AdminShell>
  );
}
