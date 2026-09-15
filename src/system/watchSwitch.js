/**
 * WATCH SWITCH — runtime toggle for the self-protection monitors.
 *
 * A single persisted switch (`watch:system` in BotKV) that the owner can flip
 * from chat (`#syswatch on|off`) to stop the bot from panic-killing itself.
 * It gates BOTH self-protection layers:
 *   • systemWatch  — host health sampling, warnings and panic escalation
 *   • corePanic    — in-process overload checks + the detached force-kill watchdog
 *
 * Semantics:
 *   mode "on"            → both monitors allowed
 *   mode "off"           → both monitors refused
 *   mode unset (null)    → env defaults apply (SYSTEM_WATCH/CORE_PANIC = "off"
 *                          still disable their respective monitor)
 *
 * An explicit `#corepanic` keeps working when the switch is off — panicking is
 * an intentional, owner-invoked action, unlike automatic safety kills.
 */

import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "watch:system";

// null = not hydrated yet -> fall back to env defaults
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

/**
 * Hydrate from BotKV once (call after auth init / BotKV attach).
 * Falls back to env defaults if the DB is unavailable.
 * @returns {Promise<boolean>} whether the switch allows monitoring on now
 */
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

/**
 * Current switch state for a scope.
 * @param {"all"|"systemwatch"|"corepanic"} scope
 */
export function isWatchEnabled(scope = "all") {
  if (mode === "on") return true;
  if (mode === "off") return false;
  if (scope === "systemwatch") return envSystemWatchAllowed();
  if (scope === "corepanic") return envCorePanicAllowed();
  return envAllowsOn();
}

/**
 * Flip the switch and persist it. Applies to this process immediately;
 * on restart the persisted value wins over env.
 */
export async function setWatchEnabled(on) {
  mode = on ? "on" : "off";
  try {
    await kvSet(KEY, mode);
  } catch {
    /* DB write not critical — apply for this process only */
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