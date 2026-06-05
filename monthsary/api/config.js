const CONFIG_KEY = "monthsary-site-content-v1";
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
    const error = new Error("Hosted config storage is not configured.");
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
    const error = new Error(payload.error || "Hosted config storage request failed.");
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

module.exports = async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const saved = await runRedisCommand(["GET", CONFIG_KEY]);
      sendJson(response, 200, { content: saved ? JSON.parse(saved) : null });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }

    return;
  }

  if (request.method === "PUT") {
    try {
      const { adminCode, googleIdToken, content } = await readRequestBody(request);

      if (!(await canManageSite({ adminCode, googleIdToken }))) {
        sendJson(response, 401, { error: "That editor code is not allowed to save online." });
        return;
      }

      if (!content || typeof content !== "object") {
        sendJson(response, 400, { error: "Missing configuration content." });
        return;
      }

      await runRedisCommand(["SET", CONFIG_KEY, JSON.stringify(content)]);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }

    return;
  }

  response.setHeader("Allow", "GET, PUT");
  sendJson(response, 405, { error: "Method not allowed." });
};
