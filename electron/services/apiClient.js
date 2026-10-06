// All backend traffic goes through the main process. Cookies live in an Electron session partition;
// the renderer never sees tokens, cookies or the raw fetch.
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const PATH_RE = /^\/api\/[A-Za-z0-9/_\-.?=&%]{0,300}$/;

function checkRequest(method, path, body) {
  if (!ALLOWED_METHODS.has(method)) throw new Error("Invalid request: method");
  if (
    typeof path !== "string" ||
    !PATH_RE.test(path) ||
    path.includes("..") ||
    path.startsWith("/api/payments/sslcommerz")
  )
    throw new Error("Invalid request: path");
  if (body !== undefined && JSON.stringify(body).length > 100000)
    throw new Error("Invalid request: body too large");
}

function createApiClient({
  fetchImpl,
  getBase,
  version = "",
  timeoutMs = 15000,
}) {
  async function once(method, path, body) {
    try {
      const res = await fetchImpl(getBase() + path, {
        method,
        credentials: "include",
        headers: {
          ...(version ? { "x-client-version": version } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON body */
      }
      return { status: res.status, data };
    } catch (e) {
      return {
        status: 0,
        networkError: true,
        data: {
          error: "Cannot reach the server. Check your internet connection.",
        },
      };
    } // DNS, TLS, timeout, offline
  }
  // One transparent refresh on an expired session, never for the auth endpoints themselves.
  async function request(method, path, body) {
    checkRequest(method, path, body);
    let r = await once(method, path, body);
    if (r.status === 401 && !path.startsWith("/api/auth/")) {
      const rf = await once("POST", "/api/auth/refresh");
      if (rf.status === 200) r = await once(method, path, body);
    }
    return r;
  }
  return { request };
}
module.exports = { createApiClient, checkRequest };
