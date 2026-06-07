const RESPONSES_KEY = "monthsary-site-responses-v1";
const { canManageSite } = require("./_auth");

function getRedisCredentials() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function runRedisCommand(command) {
  const { url, token } = getRedisCredentials();

  if (!url || !token) {
    const error = new Error("Hosted response storage is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || "Hosted response storage request failed.");
    error.statusCode = response.status;
    throw error;
  }

  return payload.result;
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function parseSavedResponses(saved) {
  return (Array.isArray(saved) ? saved : [])
    .map((item, index) => {
      try {
        const parsed = JSON.parse(item);

        if (!parsed.id) {
          parsed.id = `legacy-${parsed.submittedAt || "unknown"}-${index}`;
        }

        return parsed;
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = async function handler(request, response) {
  if (request.method === "POST") {
    try {
      const { response: savedResponse } = await readRequestBody(request);

      if (!savedResponse || typeof savedResponse !== "object") {
        sendJson(response, 400, { error: "Missing response data." });
        return;
      }

      await runRedisCommand(["LPUSH", RESPONSES_KEY, JSON.stringify(savedResponse)]);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }

    return;
  }

  if (request.method === "GET") {
    try {
      const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
      const adminCode = url.searchParams.get("adminCode") || "";
      const googleIdToken = url.searchParams.get("googleIdToken") || "";

      if (!(await canManageSite({ adminCode, googleIdToken }))) {
        sendJson(response, 401, { error: "That editor code cannot view responses." });
        return;
      }

      const saved = await runRedisCommand(["LRANGE", RESPONSES_KEY, "0", "99"]);
      const responses = parseSavedResponses(saved);

      sendJson(response, 200, { responses });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }

    return;
  }

  if (request.method === "DELETE") {
    try {
      const { adminCode, googleIdToken, responseId } = await readRequestBody(request);

      if (!(await canManageSite({ adminCode, googleIdToken }))) {
        sendJson(response, 401, { error: "That editor code cannot delete responses." });
        return;
      }

      if (!responseId) {
        sendJson(response, 400, { error: "Missing response id." });
        return;
      }

      const saved = await runRedisCommand(["LRANGE", RESPONSES_KEY, "0", "99"]);
      const index = (Array.isArray(saved) ? saved : []).findIndex((item, itemIndex) => {
        try {
          const parsed = JSON.parse(item);
          const id = parsed.id || `legacy-${parsed.submittedAt || "unknown"}-${itemIndex}`;
          return id === responseId;
        } catch (error) {
          return false;
        }
      });

      if (index < 0) {
        sendJson(response, 404, { error: "That response was not found." });
        return;
      }

      const marker = `__deleted_response_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
      await runRedisCommand(["LSET", RESPONSES_KEY, String(index), marker]);
      await runRedisCommand(["LREM", RESPONSES_KEY, "1", marker]);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }

    return;
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  sendJson(response, 405, { error: "Method not allowed." });
};
