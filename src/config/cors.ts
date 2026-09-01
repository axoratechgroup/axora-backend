import "dotenv/config";
import type { CorsOptions } from "cors";

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")

  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsOptions: CorsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};
