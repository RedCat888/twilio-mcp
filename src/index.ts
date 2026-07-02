import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import twilio from "twilio";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env manually (no dotenv dep needed)
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dir, "../.env");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch {
  // .env not found — rely on env vars already set
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const apiKeySid = process.env.TWILIO_API_KEY_SID;
const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

if (!accountSid || !apiKeySid || !apiKeySecret) {
  process.stderr.write(
    "Missing required env: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET\n"
  );
  process.exit(1);
}

const client = twilio(apiKeySid, apiKeySecret, { accountSid });

const server = new McpServer({
  name: "twilio-phone-numbers",
  version: "1.0.0",
});

// ── TOOL 1: search_available_numbers ─────────────────────────────────────────
server.tool(
  "search_available_numbers",
  "Search available US phone numbers by area code, contains pattern, and capabilities.",
  {
    areaCode: z.number().int().min(200).max(999).optional().describe("US area code, e.g. 415"),
    contains: z.string().min(2).optional().describe("Digit pattern to match, min 2 chars, e.g. '555'"),
    smsEnabled: z.boolean().default(true).describe("Filter for SMS-capable numbers"),
    voiceEnabled: z.boolean().default(true).describe("Filter for voice-capable numbers"),
    mmsEnabled: z.boolean().default(false).describe("Filter for MMS-capable numbers"),
    limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
  },
  async ({ areaCode, contains, smsEnabled, voiceEnabled, mmsEnabled, limit }) => {
    try {
      // Only pass a capability filter when it is requested (true). Twilio treats
      // an explicit `false` (e.g. MmsEnabled=false) as "exclude numbers that HAVE
      // that capability" — and nearly every US local number is MMS/SMS/voice
      // capable, so passing false here silently filters out all results.
      const params: Record<string, unknown> = { limit };
      if (smsEnabled) params.smsEnabled = true;
      if (voiceEnabled) params.voiceEnabled = true;
      if (mmsEnabled) params.mmsEnabled = true;
      if (areaCode) params.areaCode = areaCode;
      if (contains) params.contains = contains;

      const numbers = await client.availablePhoneNumbers("US").local.list(params);

      if (numbers.length === 0) {
        return { content: [{ type: "text", text: "No available numbers found matching your criteria." }] };
      }

      const result = numbers.map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        postalCode: n.postalCode,
        capabilities: n.capabilities,
      }));

      return {
        content: [
          { type: "text", text: `Found ${numbers.length} available number(s):` },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err: unknown) {
      const e = err as { message: string; code?: number };
      return { content: [{ type: "text", text: `Error: ${e.message}${e.code ? ` (code ${e.code})` : ""}` }] };
    }
  }
);

// ── TOOL 2: list_owned_numbers ────────────────────────────────────────────────
server.tool(
  "list_owned_numbers",
  "List all phone numbers currently owned in your Twilio account.",
  {},
  async () => {
    try {
      const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });

      if (numbers.length === 0) {
        return { content: [{ type: "text", text: "No phone numbers found in your account." }] };
      }

      const result = numbers.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        capabilities: n.capabilities,
        voiceUrl: n.voiceUrl || null,
        smsUrl: n.smsUrl || null,
        statusCallback: n.statusCallback || null,
        voiceApplicationSid: n.voiceApplicationSid || null,
        smsApplicationSid: n.smsApplicationSid || null,
        trunkSid: n.trunkSid || null,
        dateCreated: n.dateCreated,
      }));

      return {
        content: [
          { type: "text", text: `You own ${numbers.length} number(s):` },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err: unknown) {
      const e = err as { message: string; code?: number };
      return { content: [{ type: "text", text: `Error: ${e.message}${e.code ? ` (code ${e.code})` : ""}` }] };
    }
  }
);

// ── TOOL 3: buy_number ────────────────────────────────────────────────────────
server.tool(
  "buy_number",
  "Purchase/provision a phone number. Always confirm with the user before calling this.",
  {
    phoneNumber: z.string().describe("E.164 format number to buy, e.g. +14155551234"),
    friendlyName: z.string().optional().describe("Human-readable label for this number"),
    voiceUrl: z.string().url().optional().describe("Webhook URL for incoming voice calls"),
    smsUrl: z.string().url().optional().describe("Webhook URL for incoming SMS"),
    statusCallback: z.string().url().optional().describe("URL for status updates"),
    confirmed: z.boolean().describe("Must be true — confirm you've asked the user before buying"),
  },
  async ({ phoneNumber, friendlyName, voiceUrl, smsUrl, statusCallback, confirmed }) => {
    if (!confirmed) {
      return {
        content: [{
          type: "text",
          text: `⚠️ NOT purchased. You must confirm with the user first, then call this tool again with confirmed: true.\nNumber to buy: ${phoneNumber}`,
        }],
      };
    }

    try {
      const params: Record<string, string> = { phoneNumber };
      if (friendlyName) params.friendlyName = friendlyName;
      if (voiceUrl) params.voiceUrl = voiceUrl;
      if (smsUrl) params.smsUrl = smsUrl;
      if (statusCallback) params.statusCallback = statusCallback;

      const number = await client.incomingPhoneNumbers.create(params);

      return {
        content: [
          { type: "text", text: `✅ Successfully purchased ${number.phoneNumber}` },
          {
            type: "text",
            text: JSON.stringify({
              sid: number.sid,
              phoneNumber: number.phoneNumber,
              friendlyName: number.friendlyName,
              capabilities: number.capabilities,
              voiceUrl: number.voiceUrl,
              smsUrl: number.smsUrl,
            }, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const e = err as { message: string; code?: number };
      return { content: [{ type: "text", text: `Error buying number: ${e.message}${e.code ? ` (code ${e.code})` : ""}` }] };
    }
  }
);

// ── TOOL 4: update_number ─────────────────────────────────────────────────────
server.tool(
  "update_number",
  "Update settings on an owned phone number by SID.",
  {
    sid: z.string().describe("The IncomingPhoneNumber SID (starts with PN...)"),
    friendlyName: z.string().optional(),
    voiceUrl: z.string().optional().describe("Set to empty string '' to clear"),
    smsUrl: z.string().optional().describe("Set to empty string '' to clear"),
    statusCallback: z.string().optional(),
    voiceApplicationSid: z.string().optional().describe("TwiML App SID — clears voiceUrl"),
    smsApplicationSid: z.string().optional().describe("TwiML App SID — clears smsUrl"),
    trunkSid: z.string().optional().describe("SIP Trunk SID — clears voiceApplicationSid"),
    voiceFallbackUrl: z.string().optional(),
    smsFallbackUrl: z.string().optional(),
  },
  async ({ sid, ...updates }) => {
    try {
      const allowed = [
        "friendlyName", "voiceUrl", "smsUrl", "statusCallback",
        "voiceApplicationSid", "smsApplicationSid", "trunkSid",
        "voiceFallbackUrl", "smsFallbackUrl",
      ];

      const params: Record<string, string> = {};
      for (const key of allowed) {
        if (updates[key as keyof typeof updates] !== undefined) {
          params[key] = updates[key as keyof typeof updates] as string;
        }
      }

      if (Object.keys(params).length === 0) {
        return { content: [{ type: "text", text: "No fields to update were provided." }] };
      }

      const number = await client.incomingPhoneNumbers(sid).update(params);

      return {
        content: [
          { type: "text", text: `✅ Updated ${number.phoneNumber}` },
          {
            type: "text",
            text: JSON.stringify({
              sid: number.sid,
              phoneNumber: number.phoneNumber,
              friendlyName: number.friendlyName,
              voiceUrl: number.voiceUrl,
              smsUrl: number.smsUrl,
              statusCallback: number.statusCallback,
              voiceApplicationSid: number.voiceApplicationSid,
              smsApplicationSid: number.smsApplicationSid,
              trunkSid: number.trunkSid,
            }, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const e = err as { message: string; code?: number };
      return { content: [{ type: "text", text: `Error: ${e.message}${e.code ? ` (code ${e.code})` : ""}` }] };
    }
  }
);

// ── TOOL 5: release_number ────────────────────────────────────────────────────
server.tool(
  "release_number",
  "Permanently release/delete an owned phone number. IRREVERSIBLE. Always confirm with user first.",
  {
    sid: z.string().describe("The IncomingPhoneNumber SID to release (starts with PN...)"),
    confirmed: z.boolean().describe("Must be true — confirm you've asked the user and they said yes"),
  },
  async ({ sid, confirmed }) => {
    if (!confirmed) {
      return {
        content: [{
          type: "text",
          text: `⚠️ NOT released. This is IRREVERSIBLE — ask the user to confirm, then call again with confirmed: true.\nSID: ${sid}`,
        }],
      };
    }

    try {
      await client.incomingPhoneNumbers(sid).remove();
      return {
        content: [{
          type: "text",
          text: `✅ Number ${sid} has been released. It is gone permanently.`,
        }],
      };
    } catch (err: unknown) {
      const e = err as { message: string; code?: number };
      return { content: [{ type: "text", text: `Error releasing number: ${e.message}${e.code ? ` (code ${e.code})` : ""}` }] };
    }
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
