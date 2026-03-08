#!/usr/bin/env node

/**
 * Interactive setup script to authenticate with Strava.
 *
 * Steps:
 * 1. User creates a Strava API app at https://www.strava.com/settings/api
 * 2. User provides client_id and client_secret
 * 3. Script opens browser for OAuth2 authorization
 * 4. User pastes the authorization code
 * 5. Script exchanges code for tokens and saves them
 */

import { createServer } from "http";
import { writeFile } from "fs/promises";
import { resolve } from "path";
import { createInterface } from "readline";

const TOKEN_URL = "https://www.strava.com/oauth/token";
const AUTH_URL = "https://www.strava.com/oauth/authorize";
const REDIRECT_PORT = 8371;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("=== Strava MCP — Setup ===\n");
  console.log("1. Go to https://www.strava.com/settings/api");
  console.log("2. Create an API Application (or use an existing one)");
  console.log(`3. Set the 'Authorization Callback Domain' to: localhost`);
  console.log("");

  const clientId = await prompt("Enter your Client ID: ");
  const clientSecret = await prompt("Enter your Client Secret: ");

  if (!clientId || !clientSecret) {
    console.error("Client ID and Client Secret are required.");
    process.exit(1);
  }

  const scope = "read,activity:read_all,profile:read_all";
  const authUrl = `${AUTH_URL}?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&approval_prompt=auto`;

  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization...\n");

  // Start a local server to catch the redirect
  const code = await new Promise<string>((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Authorization denied</h1><p>You can close this tab.</p>");
          server.close();
          reject(new Error(`Authorization denied: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>"
          );
          server.close();
          resolveCode(code);
          return;
        }
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Listening on http://localhost:${REDIRECT_PORT} for callback...`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 5 minutes."));
    }, 5 * 60 * 1000);
  });

  console.log("Authorization code received. Exchanging for tokens...\n");

  // Exchange authorization code for tokens
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Token exchange failed (${resp.status}): ${text}`);
    process.exit(1);
  }

  const data = await resp.json();

  const tokens = {
    client_id: clientId,
    client_secret: clientSecret,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };

  const outputPath = resolve(
    process.env.STRAVA_TOKEN_FILE ??
      "~/.strava-tokens.json".replace("~", process.env.HOME ?? "")
  );

  await writeFile(outputPath, JSON.stringify(tokens, null, 2));

  console.log(`Tokens saved to: ${outputPath}`);
  console.log(`\nAthlete: ${data.athlete?.firstname} ${data.athlete?.lastname}`);
  console.log("\nSetup complete! You can now use the Strava MCP server.");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
