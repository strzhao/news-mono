export interface AiTodoNotePayload {
  title: string;
  tags: string[];
}

export class AiTodoClientError extends Error {}

export class AiTodoClient {
  private readonly apiUrl: string;
  private readonly spaceId: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(apiUrl: string, spaceId: string, token: string, timeoutSeconds = 20, maxRetries = 3) {
    this.apiUrl = String(apiUrl || "")
      .trim()
      .replace(/\/+$/, "");
    this.spaceId = String(spaceId || "").trim();
    this.token = String(token || "").trim();
    this.timeoutMs = Math.max(1_000, Math.trunc(timeoutSeconds * 1_000));
    this.maxRetries = Math.max(1, Math.trunc(maxRetries));
    if (!this.apiUrl) throw new AiTodoClientError("Missing AI_TODO_API_URL");
    if (!this.spaceId) throw new AiTodoClientError("Missing AI_TODO_SPACE_ID");
    if (!this.token) throw new AiTodoClientError("Missing AI_TODO_SPACE_TOKEN");
  }

  async createNote(payload: AiTodoNotePayload): Promise<void> {
    const url = `${this.apiUrl}/api/spaces/${this.spaceId}/notes`;
    let backoffMs = 1_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({ title: payload.title, tags: payload.tags }),
          signal: controller.signal,
        });

        if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
          const text = await response.text();
          throw new AiTodoClientError(`temporary error (${response.status}): ${text}`);
        }
        if (!response.ok) {
          const text = await response.text();
          throw new AiTodoClientError(`request failed (${response.status}): ${text}`);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new AiTodoClientError(
      `ai-todo sync failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
}
