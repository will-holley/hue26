#!/usr/bin/env -S npx tsx
import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import dotenv from "dotenv";

dotenv.config();

// Hue bridge uses self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BRIDGE_IP = process.env.HUE_BRIDGE_IP;
const API_TOKEN = process.env.HUE_API_TOKEN;

if (!BRIDGE_IP || !API_TOKEN) {
  process.exit(1);
}

const fetchJson = async (path, init = {}) => {
  const url = `https://${BRIDGE_IP}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      "hue-application-key": API_TOKEN,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
};

const activateScene = async (sceneId, sceneType = "scene") => {
  const resourceType = sceneType === "smart_scene" ? "smart_scene" : "scene";
  // Smart scenes use "activate" action, regular scenes use "active"
  const action = sceneType === "smart_scene" ? "activate" : "active";
  const res = await fetch(
    `https://${BRIDGE_IP}/clip/v2/resource/${resourceType}/${sceneId}`,
    {
      method: "PUT",
      headers: {
        "hue-application-key": API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recall: { action } }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
};

function xyBriToHex(x, y, bri = 254) {
  if (typeof x !== "number" || typeof y !== "number" || y === 0) return null;

  const z = 1 - x - y;
  const Y = bri / 254;
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;

  const gamma = (c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  r = gamma(r);
  g = gamma(g);
  b = gamma(b);

  const clamp = (c) => Math.max(0, Math.min(1, c));
  r = clamp(r);
  g = clamp(g);
  b = clamp(b);

  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function mirekToHex(mirek) {
  if (typeof mirek !== "number" || mirek <= 0) return null;
  const kelvin = 1_000_000 / mirek;
  const temp = kelvin / 100;
  let r;
  let g;
  let b;

  if (temp <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
    b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    b = 255;
  }

  const toHex = (v) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function dedupeColors(colors, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const color of colors) {
    if (!color) continue;
    const key = color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
    if (out.length >= limit) break;
  }
  return out;
}

function extractColors(scene) {
  const palette = scene.palette || {};

  const paletteColors = (palette.color || []).map((entry) =>
    xyBriToHex(
      entry?.color?.xy?.x,
      entry?.color?.xy?.y,
      entry?.dimming?.brightness,
    ),
  );
  const paletteTemperatures = (palette.color_temperature || []).map((entry) =>
    mirekToHex(entry?.color_temperature?.mirek),
  );
  const actionColors = (scene.actions || []).map((a) =>
    xyBriToHex(
      a?.action?.color?.xy?.x,
      a?.action?.color?.xy?.y,
      a?.action?.dimming?.brightness,
    ),
  );
  const actionTemperatures = (scene.actions || []).map((a) =>
    mirekToHex(a?.action?.color_temperature?.mirek),
  );

  const combined = [
    ...paletteColors,
    ...paletteTemperatures,
    ...actionColors,
    ...actionTemperatures,
  ];
  const deduped = dedupeColors(combined);
  return deduped.length ? deduped : ["#444444"];
}

const Swatches = ({ colors }) => {
  // Gradient requires at least 2 colors, duplicate if only 1
  const gradientColors = colors.length < 2 ? [...colors, ...colors] : colors;
  return (
    <Box marginLeft={1}>
      <Gradient colors={gradientColors}>{"████████████████"}</Gradient>
    </Box>
  );
};

const BrightnessBar = ({ level }) => {
  const barWidth = 20;
  const filled = Math.round((level / 100) * barWidth);
  const empty = barWidth - filled;
  return (
    <Box>
      <Text color="yellow">Brightness: </Text>
      <Text color="yellow">{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>
      <Text color="white"> {Math.round(level)}%</Text>
    </Box>
  );
};

const SceneList = () => {
  const { exit } = useApp();
  const [scenes, setScenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [setMode, setSetMode] = useState(false);
  const [brightnessMode, setBrightnessMode] = useState(false);
  const [brightness, setBrightness] = useState(100);
  const [lights, setLights] = useState([]);
  const [lightsOn, setLightsOn] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Fetch scenes, smart scenes, and lights
        const [sceneData, smartSceneData, lightData] = await Promise.all([
          fetchJson("/clip/v2/resource/scene"),
          fetchJson("/clip/v2/resource/smart_scene").catch(() => ({
            data: [],
          })),
          fetchJson("/clip/v2/resource/light"),
        ]);

        const regularScenes =
          sceneData?.data?.map((scene) => ({
            id: scene.id,
            name: scene.metadata?.name || "Untitled",
            colors: extractColors(scene),
            type: "scene",
          })) ?? [];

        const smartScenes =
          smartSceneData?.data?.map((scene) => ({
            id: scene.id,
            name: scene.metadata?.name || "Untitled",
            colors: ["#6366f1", "#8b5cf6"], // Smart scenes don't have static colors
            type: "smart_scene",
          })) ?? [];

        const allScenes = [...regularScenes, ...smartScenes];
        allScenes.sort((a, b) => a.name.localeCompare(b.name));
        setScenes(allScenes);

        // Store lights and calculate average brightness
        const lightsArray = lightData?.data ?? [];
        setLights(lightsArray);
        if (lightsArray.length > 0) {
          const anyOn = lightsArray.some((l) => l.on?.on);
          setLightsOn(anyOn);
          const onLights = lightsArray.filter((l) => l.on?.on);
          if (onLights.length > 0) {
            const avgBrightness =
              onLights.reduce(
                (sum, l) => sum + (l.dimming?.brightness ?? 100),
                0,
              ) / onLights.length;
            setBrightness(avgBrightness);
          }
        }
      } catch (err) {
        setError(err.message ?? String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const doActivate = (scene) => {
    if (!scene) return;
    (async () => {
      setMessage("");
      try {
        await activateScene(scene.id, scene.type);
        // Refresh brightness after scene activation
        await new Promise((r) => setTimeout(r, 200));
        const lightData = await fetchJson("/clip/v2/resource/light");
        const lightsArray = lightData?.data ?? [];
        setLights(lightsArray);
        if (lightsArray.length > 0) {
          const anyOn = lightsArray.some((l) => l.on?.on);
          setLightsOn(anyOn);
          const onLights = lightsArray.filter((l) => l.on?.on);
          if (onLights.length > 0) {
            const avgBrightness =
              onLights.reduce(
                (sum, l) => sum + (l.dimming?.brightness ?? 100),
                0,
              ) / onLights.length;
            setBrightness(avgBrightness);
          }
        }
      } catch (err) {
        setMessage(`Failed to activate: ${err.message ?? err}`);
      }
    })();
  };

  const doSetBrightness = async (level) => {
    const clampedLevel = Math.max(1, Math.min(100, level));
    setBrightness(clampedLevel);
    try {
      await Promise.all(
        lights.map((light) =>
          fetch(`https://${BRIDGE_IP}/clip/v2/resource/light/${light.id}`, {
            method: "PUT",
            headers: { "hue-application-key": API_TOKEN },
            body: JSON.stringify({ dimming: { brightness: clampedLevel } }),
          }),
        ),
      );
    } catch (err) {
      setMessage(`Failed to set brightness: ${err.message ?? err}`);
    }
  };

  const toggleAllLights = async () => {
    try {
      // Check if any lights are currently on
      const anyLightsOn = lights.some((light) => light.on?.on);
      const targetState = !anyLightsOn;

      // Turn all lights on or off
      await Promise.all(
        lights.map((light) =>
          fetch(`https://${BRIDGE_IP}/clip/v2/resource/light/${light.id}`, {
            method: "PUT",
            headers: { "hue-application-key": API_TOKEN },
            body: JSON.stringify({ on: { on: targetState } }),
          }),
        ),
      );

      // Refresh light state
      const lightData = await fetchJson("/clip/v2/resource/light");
      const lightsArray = lightData?.data ?? [];
      setLights(lightsArray);
      setLightsOn(targetState);

      setMessage(`${targetState ? "On" : "Off"}`);
      setTimeout(() => setMessage(""), 2000);
    } catch (err) {
      setMessage(`Failed to toggle lights: ${err.message ?? err}`);
    }
  };

  useInput(
    (input, key) => {
      if (key.escape || input === "q") {
        exit();
        return;
      }
      if (input === "s" || input === "S") {
        setSetMode((m) => !m);
        setBrightnessMode(false);
        return;
      }
      if (input === "b" || input === "B") {
        setBrightnessMode((m) => !m);
        setSetMode(false);
        return;
      }
      if (input === "o" || input === "O") {
        toggleAllLights();
        return;
      }
      if (brightnessMode) {
        if (key.upArrow) {
          doSetBrightness(brightness + 1);
        } else if (key.downArrow) {
          doSetBrightness(brightness - 1);
        }
        return;
      }
      if (key.downArrow) {
        const newIdx = Math.min(selected + 1, Math.max(0, scenes.length - 1));
        setSelected(newIdx);
        if (setMode && scenes[newIdx]) {
          doActivate(scenes[newIdx]);
        }
      } else if (key.upArrow) {
        const newIdx = Math.max(selected - 1, 0);
        setSelected(newIdx);
        if (setMode && scenes[newIdx]) {
          doActivate(scenes[newIdx]);
        }
      } else if (key.return && scenes.length) {
        doActivate(scenes[selected]);
      }
    },
    [scenes, selected, setMode, brightnessMode, brightness, lights],
  );

  if (loading) {
    return <Text>Loading scenes...</Text>;
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Text>Check HUE_BRIDGE_IP and HUE_API_TOKEN in .env</Text>
      </Box>
    );
  }

  if (!scenes.length) {
    return <Text color="yellow">No scenes found.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan">
        Hue Presets (↑/↓{" "}
        {brightnessMode ? (
          <Text color="magenta">brightness</Text>
        ) : setMode ? (
          <Text color="yellow">sets active</Text>
        ) : (
          "to move"
        )}
        , Enter to activate, S scene mode, B brightness, O toggle on/off, q quit)
      </Text>
      <Box marginTop={1}>
        <BrightnessBar level={brightness} />
        {brightnessMode && <Text color="magenta"> ◀ adjusting</Text>}
        {!brightnessMode && (
          <Text color={lightsOn ? "green" : "gray"}>
            {" "}
            💡 {message || (lightsOn ? "On" : "Off")}
          </Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {scenes.map((scene, idx) => (
          <Box key={scene.id} marginBottom={1}>
            <Box width={40}>
              <Text color={idx === selected ? "cyan" : "white"}>
                {idx === selected ? "› " : "  "}
                {scene.name}
              </Text>
            </Box>
            <Swatches colors={scene.colors} />
          </Box>
        ))}
      </Box>
    </Box>
  );
};

render(<SceneList />);
