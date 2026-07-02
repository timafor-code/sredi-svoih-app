import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_ADMIN_");
  const adminBasePath = env.VITE_ADMIN_BASE_PATH || "/";

  return {
    base: adminBasePath,
    plugins: [react()],
  };
});
