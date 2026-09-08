const EMAIL_API_URL = process.env.EMAIL_API_URL;
const EMAIL_API_SECRET = process.env.EMAIL_API_SECRET;

interface SendEmailParams {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  if (!EMAIL_API_URL || !EMAIL_API_SECRET) {
    throw new Error("Falta configurar EMAIL_API_URL o EMAIL_API_SECRET en el servidor");
  }

  const response = await fetch(EMAIL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-email-api-secret": EMAIL_API_SECRET,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Error enviando email: ${response.status} ${errorBody}`);
  }
}