import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/verify-code/route";

describe("auth verify-code route", () => {
  it("returns 410 after unified auth migration", async () => {
    const response = await POST(
      new Request("https://example.com/api/auth/verify-code", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: "daniel@example.com",
          code: "123456",
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(410);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("deprecated_auth_endpoint");
  });
});
