import { describe, it, expect } from "vitest";
import { isOriginAllowed, corsOptions } from "./cors.js";

describe("CORS Configuration", () => {
  it("allows requests without origin (curl, server-to-server, mobile)", () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed("")).toBe(true);
  });

  it("allows localhost on any port", () => {
    expect(isOriginAllowed("http://localhost:5173")).toBe(true);
    expect(isOriginAllowed("http://localhost:5174")).toBe(true);
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173")).toBe(true);
  });

  it("allows Vercel production and preview subdomains", () => {
    expect(isOriginAllowed("https://axora-frontend.vercel.app")).toBe(true);
    expect(isOriginAllowed("https://axora-frontend-git-feat-test.vercel.app")).toBe(true);
    expect(isOriginAllowed("https://preview-123.vercel.app")).toBe(true);
  });

  it("blocks unauthorized external origins", () => {
    expect(isOriginAllowed("https://malicious-site.com")).toBe(false);
    expect(isOriginAllowed("https://phishing-axora.com")).toBe(false);
    expect(isOriginAllowed("http://insecure-domain.org")).toBe(false);
  });

  it("corsOptions origin callback returns true for allowed origins and false for blocked", () => {
    const originFn = corsOptions.origin as (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => void;

    originFn("http://localhost:5173", (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(true);
    });

    originFn("https://evil.com", (err, allow) => {
      expect(err).toBeNull();
      expect(allow).toBe(false);
    });
  });
});
