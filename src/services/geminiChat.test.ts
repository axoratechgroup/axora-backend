import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askGemini } from "./geminiChat.js";

describe("geminiChat service", () => {
  const originalEnv = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv;
  });

  it("lanza un error si no está configurada la GEMINI_API_KEY", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(askGemini("Hola")).rejects.toThrow(
      "Falta configurar GEMINI_API_KEY en el servidor",
    );
  });

  it("envía la petición a Gemini con generationConfig (temperature: 0.2) y retorna el texto", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "¡Hola! ¿En qué puedo ayudarte hoy en AXORA?" }],
            },
          },
        ],
      }),
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

    const result = await askGemini("¿Qué es AXORA?");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCall = fetchSpy.mock.calls[0];
    const url = fetchCall[0] as string;
    const options = fetchCall[1] as RequestInit;

    expect(url).toContain("key=test-gemini-key");
    const requestBody = JSON.parse(options.body as string);
    expect(requestBody.generationConfig).toEqual({
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 600,
    });
    expect(requestBody.systemInstruction.parts[0].text).toContain("AXORA");
    expect(requestBody.systemInstruction.parts[0].text).toContain("BLINDAJE DE SEGURIDAD");

    expect(result).toEqual({
      type: "text",
      reply: "¡Hola! ¿En qué puedo ayudarte hoy en AXORA?",
    });
  });

  it("detecta y retorna function_call correctamente", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "propose_transfer",
                    args: { recipient_username: "camilo", currency: "USD", amount: 50 },
                  },
                },
              ],
            },
          },
        ],
      }),
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse as any);

    const result = await askGemini("Transfiérele 50 USD a camilo");

    expect(result).toEqual({
      type: "function_call",
      name: "propose_transfer",
      args: { recipient_username: "camilo", currency: "USD", amount: 50 },
    });
  });
});
