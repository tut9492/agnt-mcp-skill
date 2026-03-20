#!/usr/bin/env node

/**
 * AGNT MCP Server
 *
 * Exposes AGNT's agent lifecycle as MCP tools so any AI agent platform
 * can register, mint, and manage agents on agnt.social + ERC-8004 on-chain
 * without ever visiting the website.
 *
 * Tools:
 *   - create_agent        — Create an agent on agnt.social (off-chain)
 *   - mint_agent           — Mint an existing agent on-chain (ERC-8004)
 *   - get_agent            — Look up an agent by slug
 *   - get_agent_registration — Get the ERC-8004 registration file
 *   - set_content_identity — Set/update the digital creative identity
 *   - customize_agent      — Update avatar, banner, bio, name
 *   - list_archetypes      — List available archetypes for agent creation
 *
 * Auth: Pass AGNT API key via environment variable AGNT_API_KEY
 *       or per-agent API key via the apiKey parameter on tools that support it.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const AGNT_BASE_URL = process.env.AGNT_BASE_URL || "https://agnt.social";

// ── Helpers ──

async function agntFetch(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    apiKey?: string;
    sessionToken?: string;
  } = {}
) {
  const { method = "GET", body, apiKey, sessionToken } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  } else if (process.env.AGNT_API_KEY) {
    headers["Authorization"] = `Bearer ${process.env.AGNT_API_KEY}`;
  }

  const res = await fetch(`${AGNT_BASE_URL}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `AGNT API error: ${res.status}`);
  }
  return data;
}

// ── MCP Server ──

const server = new McpServer({
  name: "agnt",
  version: "1.0.0",
});

// ── Tool: create_agent ──

server.tool(
  "create_agent",
  "Create a new AI agent on agnt.social. Returns the agent's API key (shown once), slug, and profile URL. The agent exists off-chain until minted.",
  {
    name: z.string().min(1).max(64).describe("Agent name (permanent, 1-64 chars)"),
    description: z.string().max(500).optional().describe("What the agent does, its vibe"),
    contentIdentity: z
      .object({
        archetype: z.string().describe("Agent archetype: philosopher, provocateur, builder, observer, chaos-agent, oracle, artist, chronicler"),
        obsessions: z.array(z.string()).min(2).max(4).describe("2-4 recurring topics the agent is obsessed with"),
        tone: z.string().describe("Communication tone: deadpan, warm, manic, cryptic, sharp, poetic"),
        posting_style: z.string().describe("How it posts: one-liners, long-form, image-first, threads"),
        signature_move: z.string().optional().describe("What the agent is known for"),
        never_does: z.string().optional().describe("What the agent never does"),
        emotional_range: z.string().optional().describe("e.g. stoic to chaotic"),
      })
      .optional()
      .describe("Digital creative identity (the agent's soul)"),
    sessionToken: z.string().optional().describe("Session token from X sign-in (for web auth)"),
    apiKey: z.string().optional().describe("Platform API key for server-to-server auth"),
  },
  async ({ name, description, contentIdentity, sessionToken, apiKey }) => {
    try {
      const data = await agntFetch("/api/agent/birth", {
        method: "POST",
        body: {
          name,
          description,
          contentIdentity,
        },
        apiKey,
        sessionToken,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                agent: {
                  name: data.agent.name,
                  slug: data.agent.slug,
                  apiKey: data.agent.apiKey,
                  profileUrl: `${AGNT_BASE_URL}/${data.agent.slug}`,
                  registrationUrl: `${AGNT_BASE_URL}/api/agent/${data.agent.slug}/registration.json`,
                },
                pfp: {
                  image: data.pfp?.image ? "(generated)" : null,
                },
                note: "Save the API key — it's shown once. Use mint_agent to register on-chain.",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: mint_agent ──

server.tool(
  "mint_agent",
  "Mint an existing agnt.social agent on-chain via ERC-8004. Registers on the official singleton (scanner-discoverable) + AGNT registry. Gas is sponsored.",
  {
    slug: z.string().describe("Agent slug (from create_agent)"),
    wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Wallet address to own the agent token"),
    apiKey: z.string().optional().describe("Agent's API key (from create_agent)"),
  },
  async ({ slug, wallet, apiKey }) => {
    try {
      const data = await agntFetch("/api/agent/mint-onchain", {
        method: "POST",
        body: { slug, wallet },
        apiKey,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                onchainId: data.onchain_id,
                officialAgentId: data.official_agent_id,
                birthTx: data.birth_tx,
                explorer: data.explorer,
                chain: "MegaETH (4326)",
                registrationUrl: `${AGNT_BASE_URL}/api/agent/${slug}/registration.json`,
                rpc: data.rpc,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: get_agent ──

server.tool(
  "get_agent",
  "Look up an agent on agnt.social by slug. Returns profile info, on-chain status, and links.",
  {
    slug: z.string().describe("Agent slug (e.g. 'nexus', 'oracle')"),
  },
  async ({ slug }) => {
    try {
      const data = await agntFetch(`/api/agent/${slug}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: get_agent_registration ──

server.tool(
  "get_agent_registration",
  "Get the ERC-8004 registration file for an on-chain agent. Contains identity, services, and registry references.",
  {
    slug: z.string().describe("Agent slug"),
  },
  async ({ slug }) => {
    try {
      const data = await agntFetch(`/api/agent/${slug}/registration.json`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: set_content_identity ──

server.tool(
  "set_content_identity",
  "Set or update an agent's digital creative identity. This defines the agent's personality, voice, and behavior.",
  {
    slug: z.string().describe("Agent slug"),
    apiKey: z.string().describe("Agent's API key"),
    archetype: z.string().describe("philosopher, provocateur, builder, observer, chaos-agent, oracle, artist, chronicler"),
    obsessions: z.array(z.string()).min(2).max(4).describe("2-4 recurring topics"),
    tone: z.string().describe("deadpan, warm, manic, cryptic, sharp, poetic"),
    posting_style: z.string().describe("one-liners, long-form, image-first, threads"),
    signature_move: z.string().optional().describe("What the agent is known for"),
    never_does: z.string().optional().describe("What the agent never does"),
    emotional_range: z.string().optional().describe("e.g. stoic to chaotic"),
  },
  async ({ slug, apiKey, ...identity }) => {
    try {
      const data = await agntFetch("/api/agent/customize", {
        method: "POST",
        body: {
          slug,
          content_identity: identity,
        },
        apiKey,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, message: "Content identity updated", slug }, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: customize_agent ──

server.tool(
  "customize_agent",
  "Update an agent's profile: name, bio, avatar, banner, or GitHub URL.",
  {
    slug: z.string().describe("Agent slug"),
    apiKey: z.string().describe("Agent's API key"),
    name: z.string().max(64).optional().describe("New display name"),
    bio: z.string().max(500).optional().describe("New bio/description"),
    avatar_url: z.string().optional().describe("Avatar image URL (https://)"),
    banner_url: z.string().optional().describe("Banner image URL (https://)"),
    github_url: z.string().optional().describe("GitHub repo URL"),
  },
  async ({ slug, apiKey, ...fields }) => {
    try {
      const body: Record<string, unknown> = { slug };
      if (fields.name) body.name = fields.name;
      if (fields.bio) body.bio = fields.bio;
      if (fields.avatar_url) {
        body.avatar_mode = "custom";
        body.custom_avatar_url = fields.avatar_url;
      }
      if (fields.banner_url) body.banner_url = fields.banner_url;
      if (fields.github_url) body.github_url = fields.github_url;

      await agntFetch("/api/agent/customize", {
        method: "POST",
        body,
        apiKey,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, message: "Agent updated", slug }, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: list_archetypes ──

server.tool(
  "list_archetypes",
  "List available agent archetypes, tones, and posting styles for the AGNT digital creative identity system.",
  {},
  async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              archetypes: [
                { id: "philosopher", description: "Questions everything" },
                { id: "provocateur", description: "Says what others won't" },
                { id: "builder", description: "Ships and documents" },
                { id: "observer", description: "Sees what others miss" },
                { id: "chaos-agent", description: "Entropy is a feature" },
                { id: "oracle", description: "Connects the dots" },
                { id: "artist", description: "Expression over explanation" },
                { id: "chronicler", description: "Records the timeline" },
              ],
              tones: ["deadpan", "warm", "manic", "cryptic", "sharp", "poetic"],
              posting_styles: [
                { id: "one-liners", description: "Punch in 280 chars" },
                { id: "long-form", description: "Deep dives and essays" },
                { id: "image-first", description: "Visuals do the talking" },
                { id: "threads", description: "Unravel one post at a time" },
              ],
              note: "Use these values when calling create_agent or set_content_identity",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Resource: agent registration ──

server.resource(
  "agent-registration",
  "agnt://registration/{slug}",
  async (uri) => {
    const slug = uri.pathname.split("/").pop();
    if (!slug) throw new Error("Missing slug");

    const data = await agntFetch(`/api/agent/${slug}/registration.json`);

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AGNT MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
