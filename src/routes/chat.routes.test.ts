import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeCurrency,
  normalizeAmount,
  validateAndNormalizeProposedAction,
} from "./chat.routes.js";

describe("Chat Routes & Normalization", () => {
  describe("normalizeCurrency", () => {
    it("normaliza códigos ISO soportados en minúscula o mayúscula", () => {
      expect(normalizeCurrency("usd")).toBe("USD");
      expect(normalizeCurrency("USD")).toBe("USD");
      expect(normalizeCurrency("eur")).toBe("EUR");
      expect(normalizeCurrency("cop")).toBe("COP");
      expect(normalizeCurrency("ars")).toBe("ARS");
      expect(normalizeCurrency("mxn")).toBe("MXN");
      expect(normalizeCurrency("brl")).toBe("BRL");
    });

    it("normaliza nombres coloquiales y sinónimos comunes", () => {
      expect(normalizeCurrency("dolares")).toBe("USD");
      expect(normalizeCurrency("dolar")).toBe("USD");
      expect(normalizeCurrency("dollars")).toBe("USD");
      expect(normalizeCurrency("euros")).toBe("EUR");
      expect(normalizeCurrency("pesos_colombianos")).toBe("COP");
      expect(normalizeCurrency("pesos_argentinos")).toBe("ARS");
      expect(normalizeCurrency("reales")).toBe("BRL");
    });

    it("retorna null para monedas no soportadas o entradas inválidas", () => {
      expect(normalizeCurrency("jpy")).toBeNull();
      expect(normalizeCurrency("btc")).toBeNull();
      expect(normalizeCurrency("")).toBeNull();
      expect(normalizeCurrency(undefined)).toBeNull();
      expect(normalizeCurrency(123)).toBeNull();
    });
  });

  describe("normalizeAmount", () => {
    it("convierte números válidos y redondea a 2 decimales", () => {
      expect(normalizeAmount(100)).toBe(100);
      expect(normalizeAmount(50.555)).toBe(50.56);
      expect(normalizeAmount("250.75")).toBe(250.75);
    });

    it("retorna null para montos menores o iguales a cero o no numéricos", () => {
      expect(normalizeAmount(0)).toBeNull();
      expect(normalizeAmount(-10)).toBeNull();
      expect(normalizeAmount("invalido")).toBeNull();
      expect(normalizeAmount(null)).toBeNull();
      expect(normalizeAmount(undefined)).toBeNull();
    });
  });

  describe("validateAndNormalizeProposedAction", () => {
    describe("propose_topup", () => {
      it("valida y normaliza una carga de saldo correcta", () => {
        const result = validateAndNormalizeProposedAction("propose_topup", {
          amount: "50",
          currency: "usd",
        });

        expect(result.isValid).toBe(true);
        expect(result.actionType).toBe("topup");
        expect(result.params).toEqual({ amount: 50, currency: "USD" });
        expect(result.reply).toContain("50 USD");
      });

      it("rechaza si falta el monto o la moneda y devuelve mensaje pedagógico", () => {
        const result = validateAndNormalizeProposedAction("propose_topup", {});

        expect(result.isValid).toBe(false);
        expect(result.params).toBeUndefined();
        expect(result.reply).toContain("indícame un monto numérico mayor a 0");
      });
    });

    describe("propose_transfer", () => {
      it("valida y normaliza una transferencia eliminando arrobas y mayúsculas de moneda", () => {
        const result = validateAndNormalizeProposedAction("propose_transfer", {
          recipient_username: "@carlitos",
          amount: 25,
          currency: "cop",
        });

        expect(result.isValid).toBe(true);
        expect(result.actionType).toBe("transfer");
        expect(result.params).toEqual({
          recipient_username: "carlitos",
          amount: 25,
          currency: "COP",
        });
        expect(result.reply).toContain("transferir 25 COP al usuario carlitos");
      });

      it("rechaza si falta el destinatario", () => {
        const result = validateAndNormalizeProposedAction("propose_transfer", {
          amount: 25,
          currency: "USD",
        });

        expect(result.isValid).toBe(false);
        expect(result.reply).toContain("nombre de usuario del destinatario");
      });

      it("rechaza si falta el monto o moneda", () => {
        const result = validateAndNormalizeProposedAction("propose_transfer", {
          recipient_username: "carlitos",
        });

        expect(result.isValid).toBe(false);
        expect(result.reply).toContain("especifica un monto mayor a 0");
      });
    });

    describe("propose_exchange", () => {
      it("valida y normaliza un intercambio entre monedas válidas", () => {
        const result = validateAndNormalizeProposedAction("propose_exchange", {
          amount: "100",
          from_currency: "usd",
          to_currency: "eur",
        });

        expect(result.isValid).toBe(true);
        expect(result.actionType).toBe("exchange");
        expect(result.params).toEqual({
          from_currency: "USD",
          to_currency: "EUR",
          amount: 100,
        });
        expect(result.reply).toContain("convertir 100 USD a EUR");
      });

      it("rechaza si la moneda de origen y destino son iguales", () => {
        const result = validateAndNormalizeProposedAction("propose_exchange", {
          amount: 100,
          from_currency: "usd",
          to_currency: "USD",
        });

        expect(result.isValid).toBe(false);
        expect(result.reply).toContain("deben ser distintas");
      });

      it("rechaza si faltan parámetros", () => {
        const result = validateAndNormalizeProposedAction("propose_exchange", {
          amount: 100,
        });

        expect(result.isValid).toBe(false);
        expect(result.reply).toContain("especifica el monto a convertir");
      });
    });

    describe("función desconocida", () => {
      it("responde con mensaje aclaratorio si la función no existe", () => {
        const result = validateAndNormalizeProposedAction("desconocida", {});
        expect(result.isValid).toBe(false);
        expect(result.reply).toContain("No comprendí la operación solicitada");
      });
    });
  });
});

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../services/geminiChat.js", () => ({
  askGemini: vi.fn(),
}));

import { askGemini } from "../services/geminiChat.js";
import { chatRouter } from "./chat.routes.js";

const askGeminiMock = vi.mocked(askGemini);

const app = express();
app.use(express.json());
app.use(chatRouter);

describe("Chat Endpoints (/chat & /chat/confirm)", () => {
  const token = jwt.sign({ id: "user-1", email: "user1@axora.test" }, "test-secret-key-123456");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret-key-123456";
  });

  describe("POST /chat", () => {
    it("requiere autenticación", async () => {
      const res = await request(app).post("/chat").send({ message: "Hola" });
      expect(res.status).toBe(401);
    });

    it("rechaza peticiones sin mensaje", async () => {
      const res = await request(app)
        .post("/chat")
        .set("Authorization", `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Falta el mensaje");
    });

    it("retorna propuesta normalizada cuando Gemini invoca propose_topup con datos válidos", async () => {
      askGeminiMock.mockResolvedValueOnce({
        type: "function_call",
        name: "propose_topup",
        args: { amount: "100", currency: "usd" },
      });

      const res = await request(app)
        .post("/chat")
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "recargar 100 dolares" });

      expect(res.status).toBe(200);
      expect(res.body.proposedAction).toEqual({
        type: "topup",
        params: { amount: 100, currency: "USD" },
      });
      expect(res.body.reply).toContain("100 USD");
    });

    it("no retorna proposedAction y responde con aclaración pedagógica si los parámetros están incompletos", async () => {
      askGeminiMock.mockResolvedValueOnce({
        type: "function_call",
        name: "propose_topup",
        args: {},
      });

      const res = await request(app)
        .post("/chat")
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "dame plata" });

      expect(res.status).toBe(200);
      expect(res.body.proposedAction).toBeUndefined();
      expect(res.body.reply).toContain("monto numérico mayor a 0");
    });

    it("retorna texto conversacional de Gemini", async () => {
      askGeminiMock.mockResolvedValueOnce({
        type: "text",
        reply: "En AXORA puedes cambiar divisas entre USD, EUR, COP, ARS, MXN y BRL.",
      });

      const res = await request(app)
        .post("/chat")
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "¿Qué monedas soportan?" });

      expect(res.status).toBe(200);
      expect(res.body.reply).toContain("En AXORA puedes cambiar divisas");
    });
  });

  describe("POST /chat/confirm", () => {
    it("retorna 400 si la acción es inválida", async () => {
      const res = await request(app)
        .post("/chat/confirm")
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "invalido", params: {} });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Acción inválida");
    });
  });
});
