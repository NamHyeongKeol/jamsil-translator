import { describe, expect, it } from "vitest";
import { ensureDatabaseSchemaParam } from "./database-url";

describe("ensureDatabaseSchemaParam", () => {
  it("returns undefined for empty input", () => {
    expect(ensureDatabaseSchemaParam(undefined, "app")).toBeUndefined();
  });

  it("adds schema when query params are absent", () => {
    const url = "postgresql://user:pass@localhost:5432/postgres";
    const resolved = ensureDatabaseSchemaParam(url, "app");
    expect(resolved).toBe("postgresql://user:pass@localhost:5432/postgres?schema=app");
  });

  it("adds schema while preserving existing params", () => {
    const url = "postgresql://user:pass@localhost:5432/postgres?sslmode=require";
    const resolved = ensureDatabaseSchemaParam(url, "app");
    expect(resolved).toBe("postgresql://user:pass@localhost:5432/postgres?sslmode=require&schema=app");
  });

  it("keeps explicit schema unchanged", () => {
    const url = "postgresql://user:pass@localhost:5432/postgres?schema=public&sslmode=require";
    const resolved = ensureDatabaseSchemaParam(url, "app");
    expect(resolved).toBe(url);
  });

  it("returns raw value for malformed url", () => {
    const malformed = "postgresql://::not-a-valid-url";
    const resolved = ensureDatabaseSchemaParam(malformed, "app");
    expect(resolved).toBe(malformed);
  });
});
