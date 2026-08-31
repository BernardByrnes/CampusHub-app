import { getHealth } from "@/application/system/get-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(getHealth());
}
