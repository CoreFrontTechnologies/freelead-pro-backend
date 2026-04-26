# FreeLead Pro — Backend

Automated lead generation engine for freelance web designers.

## Features
- **Job Board Scraper** — RemoteOK, We Work Remotely, LinkedIn jobs
- **Google Maps Scanner** — Finds local businesses with no website
- **Social Media Monitor** — Twitter/X and Reddit buying intent signals
- **Domain Expiry Tracker** — WHOIS-based alerts for expiring domains
- **AI Email Generator** — Claude-powered personalised cold emails
- **Email Sender** — Gmail SMTP with auto follow-up sequences
- **SQLite Database** — Stores leads, outreach history, templates
- **Scheduled Cron Jobs** — Runs scans automatically every few hours

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
# Open .env and fill in your API keys
```

### 3. Start the server
```bash
npm run dev       # development (with auto-reload)
npm start         # production
```

The API runs on **http://localhost:3001**

---

## API Keys You Need

### Required
| Key | Where to get it | Used for |
|-----|----------------|---------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | AI email generation |
| `EMAIL_USER` + `EMAIL_PASS` | Gmail App Password | Sending outreach emails |

### Optional (enables more lead sources)
| Key | Where to get it | Used for |
|-----|----------------|---------|
| `GOOGLE_MAPS_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) → Enable "Places API" | Local business scanner |
| `TWITTER_BEARER_TOKEN` | [developer.twitter.com](https://developer.twitter.com) | Twitter/X monitoring |
| `RAPIDAPI_KEY` | [RapidAPI](https://rapidapi.com) → LinkedIn Data API | LinkedIn post scanning |

> **Gmail App Password**: Go to Google Account → Security → 2FA → App Passwords → Generate one for "Mail"

---

## API Endpoints

### Leads
```
GET    /api/leads                    # List leads (filter by status, source, score)
GET    /api/leads/:id                # Get single lead
POST   /api/leads                    # Create manual lead
PATCH  /api/leads/:id                # Update lead (status, notes, email, score)
DELETE /api/leads/:id                # Delete lead
POST   /api/leads/:id/analyse        # AI lead analysis + score
GET    /api/leads/stats/summary      # Stats (total, by status, by source)
```

### Scanning
```
POST   /api/leads/scan/all           # Trigger all scanners (runs in background)
POST   /api/leads/scan/jobs          # Job boards only
POST   /api/leads/scan/maps          # Google Maps only (body: { cities, types })
POST   /api/leads/scan/social        # Social media only
POST   /api/leads/scan/domains       # Domain tracker (body: { domains: [...] })
GET    /api/leads/scan/status        # Recent scan logs
```

### Outreach
```
POST   /api/outreach/generate             # Generate AI email for a lead
POST   /api/outreach/generate-followup   # Generate follow-up email
POST   /api/outreach/send                # Send an email
POST   /api/outreach/send-generated      # Generate + send in one step
GET    /api/outreach                      # List sent emails
POST   /api/outreach/process-followups   # Process pending follow-ups
GET    /api/outreach/stats               # Open/reply rate stats
GET    /api/outreach/verify-email        # Test email config
```

### Templates
```
GET    /api/outreach/templates        # List all templates
POST   /api/outreach/templates        # Create template
DELETE /api/outreach/templates/:id    # Delete template
```

---

## Example Requests

### Generate an AI cold email
```bash
curl -X POST http://localhost:3001/api/outreach/generate \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": 1,
    "tone": "professional",
    "sender": {
      "name": "Alex Johnson",
      "skills": "web design and Webflow development",
      "portfolioUrl": "alexdesigns.com"
    }
  }'
```

### Trigger a full scan
```bash
curl -X POST http://localhost:3001/api/leads/scan/all
```

### Update lead status
```bash
curl -X PATCH http://localhost:3001/api/leads/1 \
  -H "Content-Type: application/json" \
  -d '{ "status": "Contacted", "email": "client@example.com" }'
```

### Send a generated email
```bash
curl -X POST http://localhost:3001/api/outreach/send-generated \
  -H "Content-Type: application/json" \
  -d '{
    "lead_id": 1,
    "to": "client@example.com",
    "tone": "friendly",
    "sender": { "name": "Alex Johnson", "portfolioUrl": "alexdesigns.com" }
  }'
```

---

## Scheduled Scans (Automatic)

| Scanner | Schedule |
|---------|----------|
| Job boards | Every 2 hours |
| Google Maps | Daily at 8am |
| Social media | Every 4 hours |
| Domain tracker | Daily at 9am |
| Follow-up emails | Daily at 10am |

---

## Connecting to the Frontend

Set your React frontend's API base URL to `http://localhost:3001/api`.

Example fetch:
```js
const leads = await fetch('http://localhost:3001/api/leads?status=New&min_score=75')
  .then(r => r.json());
```

---

## Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: SQLite3
- **AI**: Anthropic Claude (claude-sonnet)
- **Email**: Nodemailer (Gmail SMTP)
- **Scraping**: Axios + Cheerio + Puppeteer
- **Scheduler**: node-cron
- **Logging**: Winston
