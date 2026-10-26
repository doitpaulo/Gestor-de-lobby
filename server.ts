import express from "express";
import path from "path";
import app from "./api/index";

const args = process.argv.slice(2);
const portFlagIndex = args.indexOf("--port");
const hostFlagIndex = args.indexOf("--host");

const cliPort = portFlagIndex !== -1 && args[portFlagIndex + 1] ? parseInt(args[portFlagIndex + 1], 10) : undefined;
const HOST = hostFlagIndex !== -1 && args[hostFlagIndex + 1] ? args[hostFlagIndex + 1] : "0.0.0.0";

// Support PORT environment variable in all environments (essential for Cloud Run publication)
const PORT = cliPort || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

const initStandAlone = async () => {
  // Serve Vite in development environment
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production env
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));

    // Express 5 compatible SPA fallback (avoids invalid route path wildcard error)
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        return res.sendFile(path.join(distPath, "index.html"));
      }
      next();
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server fully operational on http://${HOST}:${PORT}`);
  });
};

initStandAlone();

export default app;
