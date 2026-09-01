import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/auth/me/route";

describe("auth me route", () => {
  it("returns 410 after unified auth migration", async () => {
    const response = await GET(new Request("https://example.com/api/auth/me"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(410);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("deprecated_auth_endpoint");
  });
});
