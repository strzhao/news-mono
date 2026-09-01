import { redirect } from "next/navigation";
import { normalizeNextPath } from "@/lib/article-db/auth-gateway-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickString(input: string | string[] | undefined): string {
  if (Array.isArray(input)) {
    return String(input[0] || "").trim();
  }
  return String(input || "").trim();
}

export default async function LoginPage(props: {
  searchParams?: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const resolved = (await props.searchParams) || {};
  const nextPath = normalizeNextPath(pickString(resolved.next));
  redirect(`/auth/start?next=${encodeURIComponent(nextPath)}`);
}
