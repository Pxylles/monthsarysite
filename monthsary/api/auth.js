const { canManageSite } = require("./_auth");

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
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
    sendJson(response, 200, {
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_ALLOWED_EMAILS),
    });
    return;
  }

  if (request.method === "POST") {
    const { googleIdToken, adminCode } = await readRequestBody(request);
    const owner = await canManageSite({ adminCode, googleIdToken });

    if (!owner) {
      sendJson(response, 401, { error: "This account is not allowed to edit the site." });
      return;
    }

    sendJson(response, 200, { owner });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  sendJson(response, 405, { error: "Method not allowed." });
};
