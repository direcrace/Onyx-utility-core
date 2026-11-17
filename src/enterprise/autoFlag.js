
import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "autoflag_enabled";

const ENV_DEFAULT = (process.env.AUTOFLAG || process.env.AUTO_FLAG || "on")
  .trim()
  .toLowerCase() !== "off";

let cache = null;

export async function isAutoFlagEnabled() {
  if (cache !== null) return cache;

  let enabled = ENV_DEFAULT;
  try {
    const stored = await kvGet(KEY);
    if (typeof stored === "boolean") enabled = stored;
    else if (stored === "on" || stored === "1") enabled = true;
    else if (stored === "off" || stored === "0") enabled = false;
  } catch {  }

  cache = enabled;
  return enabled;
}

export async function setAutoFlagEnabled(value) {
  const enabled = !!value;
  cache = enabled;
  await kvSet(KEY, enabled);
  return enabled;
}
