import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "./db/database.js";
import { apiRouter } from "./routes/api.js";

type StartServerOptions = {
  port?: number;
  dataDir?: string;
  serveClient?: boolean;
  staticDir?: string;
};

export const startServer = async (options: StartServerOptions = {}) => {
  const port = Number(options.port ?? process.env.PORT ?? 3001);
  if (options.dataDir) {
    process.env.PAYROLL_DATA_DIR = options.dataDir;
  }
  await initializeDatabase();

  const serverApp = express();
  serverApp.use(cors());
  serverApp.use(express.json());
  serverApp.use("/api", apiRouter);

  if (options.serveClient) {
    const staticDir = options.staticDir ?? path.resolve(process.cwd(), "dist");
    serverApp.use(express.static(staticDir));
    serverApp.get(/^\/(?!api).*/, (_request, response) => {
      response.sendFile(path.join(staticDir, "index.html"));
    });
  }

  return await new Promise<import("node:http").Server>((resolve) => {
    const server = serverApp.listen(port, () => {
      console.log(`Ontario payroll API listening on http://localhost:${port}`);
      resolve(server);
    });
  });
};

const launchedFromCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (launchedFromCli) {
  void startServer();
}
