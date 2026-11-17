

import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { kvGet } from "../database/botKv.js";
import config from "../../config.js";

export async function createBackup({ includeAuth = false } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = {
    version: 1,
    createdAt: Date.now(),
    tenant: process.env.TENANT_ID || "default",
    botKv: {},
  };

  const keys = [
    "mode",
    "sudo",
    "lang",
    "feature_flags",
    "policies",
    "rbac_roles",
    "log_group_jid",
    "setup_done",
    "sticker_packname",
    "sticker_author",
    "audit_log",
  ];

  for (const k of keys) {
    try {
      payload.botKv[k] = await kvGet(k);
    } catch {
      payload.botKv[k] = null;
    }
  }

  if (includeAuth && !config.USE_POSTGRES) {

    payload.authDbPath = config.SQLITE_PATH;
  }

  const dir = path.join(os.tmpdir(), "onyx-backups");
  await fs.mkdir(dir, { recursive: true });
  const jsonPath = path.join(dir, `backup-${stamp}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  let dbCopy = null;
  if (includeAuth && !config.USE_POSTGRES && config.SQLITE_PATH) {
    try {
      dbCopy = path.join(dir, `database-${stamp}.db`);
      await fs.copyFile(config.SQLITE_PATH, dbCopy);
    } catch {
      dbCopy = null;
    }
  }

  const checksum = crypto
    .createHash("sha256")
    .update(await fs.readFile(jsonPath))
    .digest("hex")
    .slice(0, 16);

  return { jsonPath, dbCopy, checksum, payload };
}
