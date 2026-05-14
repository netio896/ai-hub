import { ApiError, jsonError } from "@/lib/http";

function extractBearerToken(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function requireServiceAuth(request: Request) {
  const expectedToken = process.env.SERVICE_API_KEY;
  if (!expectedToken) {
    return jsonError(
      new ApiError(
        503,
        "service_key_not_configured",
        "SERVICE_API_KEY is not configured on the server."
      )
    );
  }

  const token = extractBearerToken(request);
  if (!token || token !== expectedToken) {
    return jsonError(new ApiError(401, "unauthorized", "Missing or invalid bearer token."));
  }

  return null;
}
