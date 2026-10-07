import express from "express";
import path from "path";
import app from "./api/index";

const args = process.argv.slice(2);
const portFlagIndex = args.indexOf("--port");
const hostFlagIndex = args.indexOf("--host");

const cliPort = portFlagIndex !== -1 && args[portFlagIndex + 1] ? parseInt(args[portFlagIndex + 1], 10) : undefined;
const HOST = hostFlagIndex !== -1 && args[hostFlagIndex + 1] ? args[hostFlagIndex + 1] : "0.0.0.0";

// Dev server must always run on port 3000 per environment constraints unless explicitly overridden by CLI
const PORT = cliPort || (process.env.NODE_ENV === "production" && process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server fully operational on http://${HOST}:${PORT}`);
  });
};

initStandAlone();

export default app;
