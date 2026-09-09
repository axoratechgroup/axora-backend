export interface PasswordValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateStrongPassword(password: string): PasswordValidationResult {
  if (!password || password.length < 8) {
    return {
      isValid: false,
      error: "La contraseña debe tener al menos 8 caracteres",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: "La contraseña debe contener al menos una letra mayúscula",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: "La contraseña debe contener al menos una letra minúscula",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: "La contraseña debe contener al menos un número",
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      isValid: false,
      error: "La contraseña debe contener al menos un carácter especial",
    };
  }

  return { isValid: true };
}
