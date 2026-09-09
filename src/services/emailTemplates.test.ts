import { describe, expect, it } from "vitest";
import { buildPasswordResetEmail, buildWelcomeEmail, wrapEmailLayout } from "./emailTemplates.js";

describe("emailTemplates", () => {
  it("genera el correo de recuperación de contraseña con español neutro y enlace seguro", () => {
    const email = buildPasswordResetEmail("Camila", "https://axora.example/reset-password?token=abc");
    expect(email.subject).toBe("Recuperar tu contraseña de Axora");
    expect(email.text).toContain("Hola Camila,");
    expect(email.text).toContain("puedes ignorar este correo con tranquilidad.");
    expect(email.text).not.toContain("podés");
    expect(email.html).toContain("https://axora.example/reset-password?token=abc");
    expect(email.html).toContain("puedes ignorar este correo con tranquilidad.");
    expect(email.html).not.toContain("podés");
    expect(email.html).toContain("AXORA");
  });

  it("genera el correo de bienvenida con español neutro y enlace al dashboard", () => {
    const email = buildWelcomeEmail("Mateo", "https://axora.example");
    expect(email.subject).toBe("¡Bienvenido a Axora!");
    expect(email.text).toContain("Hola Mateo,");
    expect(email.text).toContain("Ya puedes cargar saldo, transferir y cambiar");
    expect(email.text).toContain("Entra a tu cuenta: https://axora.example/dashboard");
    expect(email.text).not.toContain("podés");
    expect(email.text).not.toContain("Entrá");
    expect(email.html).toContain("Ya puedes cargar saldo");
    expect(email.html).toContain("https://axora.example/dashboard");
  });

  it("escapa caracteres especiales en wrapEmailLayout para prevenir XSS", () => {
    const html = wrapEmailLayout({
      badge: "<script>alert(1)</script>",
      title: "Título & Subtítulo",
      intro: "Intro con 'comillas'",
      ctaLabel: "Haz clic > aquí",
      ctaUrl: "https://axora.example/test",
      disclaimer: "Nota <segura>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Título &amp; Subtítulo");
    expect(html).toContain("&#39;comillas&#39;");
    expect(html).toContain("Haz clic &gt; aquí");
    expect(html).toContain("&lt;segura&gt;");
  });
});
