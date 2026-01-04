# Mooncord Emoji API - Cloudflare Worker

This Cloudflare Worker handles Discord OAuth authentication and GitHub PR creation for emoji submissions.

## Setup

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Create Discord Application

1. Go to https://discord.com/developers/applications
2. Create new application "Mooncord Emoji Submissions"
3. Go to OAuth2 section
4. Add redirect URI: `https://YOUR-WORKER.workers.dev/auth/callback`
5. Copy the Client ID and Client Secret

### 3. Create GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. Select `public_repo` scope
4. Copy the token

### 4. Generate JWT Secret

Generate a random 256-bit secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 5. Configure Secrets

```bash
wrangler secret put DISCORD_CLIENT_ID
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put DISCORD_SERVER_ID
# Enter: 193277318494420992

wrangler secret put GITHUB_TOKEN
wrangler secret put JWT_SECRET
wrangler secret put FRONTEND_URL
# Enter: https://cman85.github.io/mooncord-emojis
```

### 6. Deploy

```bash
npm run deploy
```

### 7. Update Discord Redirect URI

After deploying, update the Discord application's redirect URI with your actual worker URL:
`https://mooncord-emoji-api.YOUR-SUBDOMAIN.workers.dev/auth/callback`

### 8. Update Frontend

Update `docs/app.js` with your worker URL:

```javascript
const API_BASE_URL = 'https://mooncord-emoji-api.YOUR-SUBDOMAIN.workers.dev';
```

## Development

Run locally:

```bash
npm run dev
```

View logs:

```bash
npm run tail
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/discord` | GET | Initiates Discord OAuth flow |
| `/auth/callback` | GET | Handles OAuth callback |
| `/api/submit` | POST | Creates PR for emoji submission |
| `/health` | GET | Health check endpoint |
