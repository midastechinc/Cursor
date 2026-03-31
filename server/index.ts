import cors from "cors";
import express from "express";
import { initializeDatabase } from "./db/database.js";
import { apiRouter } from "./routes/api.js";

const port = Number(process.env.PORT ?? 3001);

const start = async () => {
  await initializeDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", apiRouter);

  app.listen(port, () => {
    console.log(`Ontario payroll API listening on http://localhost:${port}`);
  });
};

void start();
