import swaggerJSDoc from "swagger-jsdoc";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AXORA API",
      version: "1.0.0",
      description:
        "API backend de AXORA, billetera digital multi-moneda. Autenticación con JWT (header `Authorization: Bearer <token>`).",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local",
      },
      {
        url: "https://axora-backend-production-4e8d.up.railway.app",
        description: "Producción (Railway)",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            first_name: { type: "string" },
            last_name: { type: "string" },
            username: { type: "string" },
            email: { type: "string", format: "email" },
            created_at: { type: "string", format: "date-time" },
          },
        },
        RegisterInput: {
          type: "object",
          required: ["first_name", "last_name", "username", "email", "password"],
          properties: {
            first_name: { type: "string", example: "Juan" },
            last_name: { type: "string", example: "Camilo" },
            username: { type: "string", example: "juanc" },
            email: { type: "string", format: "email", example: "juanc@example.com" },
            password: {
              type: "string",
              format: "password",
              minLength: 8,
              example: "contraseña123",
            },
          },
        },
        LoginInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "juanc@example.com" },
            password: { type: "string", format: "password", example: "contraseña123" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            token: {
              type: "string",
              description: "JWT, expira en 2 horas",
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  },
  apis: ["./src/**/*.ts"],
};

export const swaggerSpec = swaggerJSDoc(options);
