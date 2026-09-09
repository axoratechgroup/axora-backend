import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { corsOptions } from "./config/cors.js";
import { swaggerSpec } from "./config/swagger.js";
import { authRouter } from "./routes/auth.routes.js";
import { walletRouter } from "./routes/wallet.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { chatRouter } from "./routes/chat.routes.js";
import { ratesRouter } from "./routes/rates.routes.js";

import { pool } from "./config/database.js";

const app = express();

app.set("trust proxy", 1);

app.use(cors(corsOptions));
app.use(express.json());

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (req, res) => {
  res.json(swaggerSpec);
});

app.get("/", (req, res) => {
  res.json({
    name: "AXORA API",
    status: "healthy",
    version: "1.0.0",
    docs: "/docs",
  });
});

app.use(authRouter);
app.use(walletRouter);
app.use(adminRouter);
app.use(chatRouter);
app.use(ratesRouter);

// Manejador global de errores para asegurar respuestas JSON consistentes con cabeceras CORS
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error("Unhandled API error:", err);
  const errorObj = err as { status?: number; message?: string } | undefined;
  const status = typeof errorObj?.status === "number" ? errorObj.status : 500;
  res.status(status).json({
    error: errorObj?.message || "Error interno del servidor.",
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 AXORA Backend corriendo en http://localhost:3000");
});

