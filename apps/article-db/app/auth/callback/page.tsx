import { authIssuer } from "@/lib/article-db/auth";
import AuthCallbackClient from "./callback-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AuthCallbackPage(): React.ReactNode {
  return <AuthCallbackClient authIssuer={authIssuer()} />;
}
