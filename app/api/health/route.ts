import { getProviderReadiness } from "@/lib/provider-registry";

export async function GET() {
  return Response.json({
    ok: true,
    service: "omni-ai-hub-api",
    providers: getProviderReadiness()
  });
}
