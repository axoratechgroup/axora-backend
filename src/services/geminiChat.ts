const GEMINI_MODEL = "gemini-3.5-flash-lite"; // modelo liviano, con cuota gratuita mucho más generosa
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `Sos el asistente virtual de Axora, una billetera digital
multi-moneda. Respondé siempre en español, de forma breve, clara y amigable.
Cuando el usuario te pida transferir dinero, cargar saldo, o cambiar entre
monedas, usá la función correspondiente (propose_transfer, propose_topup,
propose_exchange) en vez de responder con texto. Si te faltan datos para
completar la función (por ejemplo no te dijo el monto o la moneda), pedíselos
en un mensaje de texto normal antes de llamar a la función.`;

interface ChatMessage {
    role: "user" | "assistant";
    text: string;
}

const TOOLS = [
    {
        functionDeclarations: [
            {
                name: "propose_transfer",
                description:
                    "Proponer una transferencia de dinero a otro usuario de Axora, identificado por su nombre de usuario",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        recipient_username: { type: "STRING", description: "Nombre de usuario del destinatario" },
                        currency: { type: "STRING", description: "Código de moneda de 3 letras, ej: USD, ARS, EUR, MXN, COP, BRL" },
                        amount: { type: "NUMBER", description: "Monto a transferir" },
                    },
                    required: ["recipient_username", "currency", "amount"],
                },
            },
            {
                name: "propose_topup",
                description: "Proponer una carga de saldo a la propia wallet del usuario",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        currency: { type: "STRING", description: "Código de moneda de 3 letras" },
                        amount: { type: "NUMBER", description: "Monto a cargar" },
                    },
                    required: ["currency", "amount"],
                },
            },
            {
                name: "propose_exchange",
                description: "Proponer un cambio (compra/venta) entre dos monedas dentro de la propia wallet del usuario",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        from_currency: { type: "STRING", description: "Moneda de origen" },
                        to_currency: { type: "STRING", description: "Moneda de destino" },
                        amount: { type: "NUMBER", description: "Monto en la moneda de origen a cambiar" },
                    },
                    required: ["from_currency", "to_currency", "amount"],
                },
            },
        ],
    },
];

export type GeminiChatResult =
    | { type: "text"; reply: string }
    | { type: "function_call"; name: string; args: Record<string, unknown> };

async function callGeminiOnce(
    apiKey: string,
    contents: { role: string; parts: { text: string }[] }[],
): Promise<Response> {
    return fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents,
            tools: TOOLS,
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        }),
    });
}

export async function askGemini(
    message: string,
    history: ChatMessage[] = [],
): Promise<GeminiChatResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("Falta configurar GEMINI_API_KEY en el servidor");
    }

    const contents = [
        ...history.map((entry) => ({
            role: entry.role === "assistant" ? "model" : "user",
            parts: [{ text: entry.text }],
        })),
        { role: "user", parts: [{ text: message }] },
    ];

    let response = await callGeminiOnce(apiKey, contents);

    let attempts = 1;
    while (response.status === 503 && attempts < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
        response = await callGeminiOnce(apiKey, contents);
        attempts++;
    }

    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Gemini respondió con error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
        candidates?: {
            content?: {
                parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
            };
        }[];
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const functionCallPart = parts.find((p) => p.functionCall);

    if (functionCallPart?.functionCall) {
        return {
            type: "function_call",
            name: functionCallPart.functionCall.name,
            args: functionCallPart.functionCall.args ?? {},
        };
    }

    const textPart = parts.find((p) => typeof p.text === "string");
    if (!textPart?.text) {
        throw new Error("Gemini no devolvió ninguna respuesta");
    }

    return { type: "text", reply: textPart.text };
}