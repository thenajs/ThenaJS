import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A interface é buildada para dentro do `dist`, ao lado do JS do servidor, e
// publicada junto: quem instala o pacote não precisa buildar nada.
export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    // Um site local: sourcemap não paga o peso no tarball.
    sourcemap: false,
  },
});
