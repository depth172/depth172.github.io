import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const siteImgDir = resolve(import.meta.dirname, "../img");

// dev時のみ、サイト共通の ../img を /img/ として配信する
const serveSiteImg = (): Plugin => ({
  name: "serve-site-img",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/img", (req, res, next) => {
      const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const file = resolve(siteImgDir, "." + path);
      if (!file.startsWith(siteImgDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return next();
      }
      res.setHeader("Content-Type", file.endsWith(".ico") ? "image/x-icon" : "image/png");
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [serveSiteImg()],
});