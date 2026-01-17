#!/usr/bin/env node

import { createInterface } from "readline";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { hostname } from "os";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (question) =>
  new Promise((resolve) => rl.question(question, resolve));

const log = (msg) => console.log(`\x1b[36m➜\x1b[0m ${msg}`);
const success = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const error = (msg) => console.log(`\x1b[31m✗\x1b[0m ${msg}`);

async function discoverBridge() {
  log("Discovering Hue Bridge on your network...");

  const res = await fetch("https://discovery.meethue.com");
  if (!res.ok) {
    throw new Error(`Discovery failed: ${res.statusText}`);
  }

  const bridges = await res.json();
  if (!bridges.length) {
    throw new Error("No Hue Bridge found on your network");
  }

  const bridge = bridges[0];
  success(`Found bridge: ${bridge.id} at ${bridge.internalipaddress}`);
  return bridge.internalipaddress;
}

async function authenticate(bridgeIp, deviceType) {
  const res = await fetch(`http://${bridgeIp}/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devicetype: deviceType }),
  });

  if (!res.ok) {
    throw new Error(`Authentication request failed: ${res.statusText}`);
  }

  const [result] = await res.json();

  if (result.error) {
    return { error: result.error };
  }

  if (result.success?.username) {
    return { username: result.success.username };
  }

  throw new Error("Unexpected response from bridge");
}

function updateEnvFile(bridgeIp, apiToken) {
  const envPath = ".env";
  let content = "";

  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  // Update or add HUE_BRIDGE_IP
  if (content.includes("HUE_BRIDGE_IP=")) {
    content = content.replace(/HUE_BRIDGE_IP=.*/g, `HUE_BRIDGE_IP=${bridgeIp}`);
  } else {
    content += `${content && !content.endsWith("\n") ? "\n" : ""}HUE_BRIDGE_IP=${bridgeIp}\n`;
  }

  // Update or add HUE_API_TOKEN
  if (content.includes("HUE_API_TOKEN=")) {
    content = content.replace(/HUE_API_TOKEN=.*/g, `HUE_API_TOKEN=${apiToken}`);
  } else {
    content += `HUE_API_TOKEN=${apiToken}\n`;
  }

  writeFileSync(envPath, content);
}

async function main() {
  console.log("\n\x1b[1m🌈 Hue Bridge Setup\x1b[0m\n");

  try {
    // Step 1: Discover bridge
    const bridgeIp = await discoverBridge();

    // Step 2: Get machine name for devicetype
    const defaultName = hostname().replace(/\.local$/, "");
    const machineName = await prompt(
      `Enter a name for this device [${defaultName}]: `
    );
    const deviceType = `hue26#${machineName || defaultName}`;
    log(`Using device type: ${deviceType}`);

    // Step 3: Prompt user to press link button
    console.log("\n\x1b[33m⚠\x1b[0m  Press the link button on your Hue Bridge");
    await prompt("   Then press Enter to continue...");

    // Step 4: Authenticate with retry
    log("Authenticating with bridge...");

    let attempts = 0;
    const maxAttempts = 3;
    let username = null;

    while (attempts < maxAttempts) {
      const result = await authenticate(bridgeIp, deviceType);

      if (result.username) {
        username = result.username;
        break;
      }

      if (result.error?.type === 101) {
        // Link button not pressed
        attempts++;
        if (attempts < maxAttempts) {
          console.log(
            `\x1b[33m⚠\x1b[0m  Link button not pressed. Retrying... (${attempts}/${maxAttempts})`
          );
          await prompt("   Press the link button, then press Enter...");
        }
      } else {
        throw new Error(result.error?.description || "Authentication failed");
      }
    }

    if (!username) {
      throw new Error(
        "Failed to authenticate after multiple attempts. Please try again."
      );
    }

    success(`Authenticated! Token: ${username.slice(0, 8)}...`);

    // Step 5: Save to .env
    updateEnvFile(bridgeIp, username);
    success("Saved configuration to .env");

    console.log("\n\x1b[32m✨ Setup complete!\x1b[0m");
    console.log("   You can now run: \x1b[1mpnpm start\x1b[0m\n");
  } catch (err) {
    error(err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();

