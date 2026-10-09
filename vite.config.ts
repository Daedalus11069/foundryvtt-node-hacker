import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import fs from "node:fs";
import ModuleData from "./module.json" with { type: "json" };

function writeDistModuleJson() {
  return {
    name: "write-dist-module-json",
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, "dist");

      // dev-env.js is only for the root-linked dev workflow; the dist build points
      // straight at its own bundled files, since dist becomes the module root there.
      const moduleJson = { ...ModuleData } as Record<string, unknown>;
      moduleJson.esmodules = ["node-hacker.js"];
      moduleJson.styles = ["node-hacker.css"];
      fs.writeFileSync(path.join(outDir, "module.json"), JSON.stringify(moduleJson, null, 2));

      for (const dir of ["lang", "templates"]) {
        fs.cpSync(path.resolve(import.meta.dirname, dir), path.join(outDir, dir), { recursive: true });
      }
    }
  };
}

const MODULE_ID = ModuleData.id;

export default defineConfig({
  base: `/modules/${MODULE_ID}/`,

  // Vue's "esm-bundler" build (what @vitejs/plugin-vue pulls in) expects the consuming
  // bundler to replace these at build time - Vite does this automatically for an app build,
  // but not for library mode, so without this Foundry's browser sees a literal, undefined
  // `process` reference at runtime ("process is not defined").
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false"
  },

  plugins: [vue(), writeDistModuleJson()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src")
    }
  },

  server: {
    port: 5173,
    open: false,
    proxy: {
      // Serves static files from the main Foundry server.
      [`^/(modules/${MODULE_ID}/(lang|templates))`]: "http://localhost:30000",

      // Everything else besides this module's own dev assets goes to the main Foundry server.
      [`^/(?!` +
        [`modules/${MODULE_ID}/@vite\\/client`, `modules/${MODULE_ID}/@id`, `modules/${MODULE_ID}/src/`].join("|") +
        ")"]: "http://localhost:30000",

      "/socket.io": { target: "ws://localhost:30000", ws: true }
    }
  },

  preview: {
    port: 5173,
    proxy: {
      [`^/(modules/${MODULE_ID}/(lang|templates))`]: "http://localhost:30000",
      [`^/(?!` + [`modules/${MODULE_ID}/src/`].join("|") + ")"]: "http://localhost:30000",
      "/socket.io": { target: "ws://localhost:30000", ws: true }
    }
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // esbuild's minifier ignores `keepNames` when it does the minify pass, so use terser
    // instead: Foundry/libwrapper hook this module's classes by name (e.g.
    // "HackerApp.prototype.render"), and those names must survive minification.
    minify: "terser",
    terserOptions: {
      keep_classnames: true,
      keep_fnames: true
    },
    lib: {
      entry: path.resolve(import.meta.dirname, "src/node-hacker.ts"),
      formats: ["es"],
      fileName: () => "node-hacker.js"
    },
    rollupOptions: {
      output: {
        // Match by extension, not an exact expected name - the bundled CSS asset's own
        // `info.name` isn't a stable "style.css" across Vite versions/configs (it's picked up
        // the entry's own name, e.g. "foundryvtt-node-hacker.css", in newer Vite), which used
        // to silently fall through to that name here while writeDistModuleJson() below kept
        // hardcoding "node-hacker.css" - a file that then didn't exist, so Foundry 404'd
        // loading styles and every window rendered completely unstyled.
        assetFileNames: (info) => (info.name?.endsWith(".css") ? "node-hacker.css" : info.name ?? "[name][extname]")
      }
    }
  }
});
