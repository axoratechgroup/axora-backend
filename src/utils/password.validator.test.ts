import { describe, expect, it } from "vitest";
import { validateStrongPassword } from "./password.validator";

describe("validateStrongPassword", () => {
  it("acepta una contraseña que cumple con todos los requisitos", () => {
    const result = validateStrongPassword("Password123!");
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rechaza una contraseña con menos de 8 caracteres", () => {
    const result = validateStrongPassword("Pass1!");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("La contraseña debe tener al menos 8 caracteres");
  });

  it("rechaza una contraseña sin mayúsculas", () => {
    const result = validateStrongPassword("password123!");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("La contraseña debe contener al menos una letra mayúscula");
  });

  it("rechaza una contraseña sin minúsculas", () => {
    const result = validateStrongPassword("PASSWORD123!");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("La contraseña debe contener al menos una letra minúscula");
  });

  it("rechaza una contraseña sin números", () => {
    const result = validateStrongPassword("Password!!!");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("La contraseña debe contener al menos un número");
  });

  it("rechaza una contraseña sin caracteres especiales", () => {
    const result = validateStrongPassword("Password123");
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("La contraseña debe contener al menos un carácter especial");
  });
});
