async function verifyGoogleOwner(idToken) {
  if (!idToken) {
    return null;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const allowedEmails = String(process.env.GOOGLE_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!clientId || !allowedEmails.length) {
    return null;
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );
  const profile = await response.json().catch(() => ({}));

  if (!response.ok) {
    return null;
  }

  const email = String(profile.email || "").toLowerCase();

  if (
    profile.aud !== clientId ||
    profile.email_verified !== "true" ||
    !allowedEmails.includes(email)
  ) {
    return null;
  }

  return {
    email,
    name: profile.name || email,
    picture: profile.picture || "",
  };
}

async function canManageSite({ adminCode, googleIdToken } = {}) {
  if (process.env.CONFIG_ADMIN_TOKEN && adminCode === process.env.CONFIG_ADMIN_TOKEN) {
    return { method: "code", email: "" };
  }

  const googleOwner = await verifyGoogleOwner(googleIdToken);

  if (googleOwner) {
    return { method: "google", ...googleOwner };
  }

  return null;
}

module.exports = {
  canManageSite,
  verifyGoogleOwner,
};
