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

const isAddressInUseError = (error: unknown): error is NodeJS.ErrnoException =>
  Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE");

export const startServer = async (options: StartServerOptions = {}) => {
  const requestedPort = Number(options.port ?? process.env.PORT ?? 3001);
  const allowPortFallback = Boolean(options.serveClient);
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

  const startListening = (listenPort: number) =>
    new Promise<{ server: import("node:http").Server; port: number }>((resolve, reject) => {
      const server = serverApp.listen(listenPort, () => {
        const address = server.address();
        const activePort = typeof address === "object" && address ? address.port : listenPort;
        console.log(`Ontario payroll API listening on http://localhost:${activePort}`);
        resolve({ server, port: activePort });
      });

      server.on("error", (error) => {
        reject(error);
      });
    });

  try {
    return await startListening(requestedPort);
  } catch (error) {
    if (!allowPortFallback || !isAddressInUseError(error)) {
      throw error;
    }

    console.warn(`Port ${requestedPort} is in use. Falling back to a dynamic local port.`);
    return await startListening(0);
  }
};

const launchedFromCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (launchedFromCli) {
  void startServer().catch((error) => {
    if (isAddressInUseError(error)) {
      console.error("Port is already in use. Set PORT environment variable or stop the conflicting process.");
      process.exit(1);
    }
    console.error("Failed to start API server:", error);
    process.exit(1);
  });
}
