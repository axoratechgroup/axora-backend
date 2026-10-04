# Changelog

Todos los cambios relevantes de `axora-backend`. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); las entradas se agrupan por fecha.

## 2026-10-02

### Añadido
- `DELETE /admin/users/:id` (solo administrador): elimina un usuario junto con su wallet y sus movimientos, en una transacción SQL. Rechaza que el admin se elimine a sí mismo y que se elimine al último administrador. Documentado en OpenAPI y con tests.

### Cambiado
- Infraestructura migrada de Railway (trial vencido) a Render (API) + Neon (PostgreSQL), sin costo ni expiración.
- Swagger usa Render como servidor por defecto.
- README: URLs y referencias de despliegue actualizadas; nota sobre el cold start del plan gratuito de Render.
