

import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "watch:system";

let mode = null;

export function envSystemWatchAllowed() {
  return (process.env.SYSTEM_WATCH || "").trim() !== "off";
}

export function envCorePanicAllowed() {
  return (process.env.CORE_PANIC || "").trim() !== "off";
}

function envAllowsOn() {
  return envSystemWatchAllowed() && envCorePanicAllowed();
}

export async function loadWatchSwitch() {
  try {
    const raw = await kvGet(KEY);
    const value = String(raw ?? "").trim().toLowerCase();
    mode = value === "on" || value === "off" ? value : null;
  } catch {
    mode = null;
  }
  return isWatchEnabled();
}

export function isWatchEnabled(scope = "all") {
  if (mode === "on") return true;
  if (mode === "off") return false;
  if (scope === "systemwatch") return envSystemWatchAllowed();
  if (scope === "corepanic") return envCorePanicAllowed();
  return envAllowsOn();
}

export async function setWatchEnabled(on) {
  mode = on ? "on" : "off";
  try {
    await kvSet(KEY, mode);
  } catch {

  }
  return isWatchEnabled();
}

export function getWatchSwitchInfo() {
  return {
    key: KEY,
    mode,
    enabled: isWatchEnabled(),
    envSystemWatch: envSystemWatchAllowed(),
    envCorePanic: envCorePanicAllowed(),
  };
}