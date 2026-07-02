# twilio-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that wraps
the Twilio Phone Numbers API, so an MCP-compatible client (e.g. an AI coding
agent) can search, list, buy, update, and release Twilio phone numbers as
tools.

## Tools

- `search_available_numbers` — search available US local numbers by area
  code, digit pattern, and capability (SMS/voice/MMS).
- `list_owned_numbers` — list all phone numbers owned on the Twilio account.
- `buy_number` — purchase/provision a number (requires explicit `confirmed:
  true` after confirming with the user).
- `update_number` — update an owned number's webhooks/settings by SID.
- `release_number` — permanently release an owned number by SID
  (irreversible; requires explicit `confirmed: true`).

## Setup

Requires a Twilio account with an [API Key](https://www.twilio.com/docs/iam/api-keys)
(not just the Auth Token).

```bash
npm install
cp .env.example .env
# fill in TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET
```

## Run

```bash
npm run dev      # run directly with tsx
npm run build    # compile to dist/
npm start         # run compiled dist/index.js
```

Communicates over stdio, so it's meant to be launched by an MCP client (e.g.
configured as a command in Cursor/Claude Desktop's MCP settings) rather than
run standalone.

## Status

Functional — five tools implemented and working against the live Twilio API.
No test suite yet.
