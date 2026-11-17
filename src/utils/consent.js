import fs from "fs";
import path from "path";
import crypto from "crypto";
import { kvGet, kvSet } from "../database/botKv.js";

const KEY = "consent:pair";

const DOCS = {
  terms: "terms-of-service.md",
  privacy: "privacy-policy.md",
};

function docPath(name) {
  const base = global.__basedir || process.cwd();
  return path.join(base, DOCS[name] || name);
}

function hashDoc(name) {
  try {
    const buf = fs.readFileSync(docPath(name));
    return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  } catch {
    return "missing";
  }
}

export function legalVersions() {
  return { terms: hashDoc("terms"), privacy: hashDoc("privacy") };
}

function norm(number) {
  return String(number || "").replace(/\D/g, "");
}

async function readAll() {
  const map = await kvGet(KEY);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export async function getConsent(number) {
  const n = norm(number);
  if (!n) return null;
  const map = await readAll();
  return map[n] || null;
}

export function consentIsCurrent(record, versions = legalVersions()) {
  return !!record && record.terms === versions.terms && record.privacy === versions.privacy;
}

export async function hasValidConsent(number) {
  return consentIsCurrent(await getConsent(number), legalVersions());
}

export async function recordConsent(number, { source = "chat", sender = null, lang = null } = {}) {
  const n = norm(number);
  if (!n) throw new Error("Invalid number");
  const map = await readAll();
  const v = legalVersions();
  const rec = {
    number: n,
    ts: Date.now(),
    terms: v.terms,
    privacy: v.privacy,
    source,
    sender: sender ? norm(sender) : null,
    lang: lang || null,
  };
  map[n] = rec;
  await kvSet(KEY, map);
  return rec;
}

export async function listConsents() {
  const map = await readAll();
  return Object.values(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
