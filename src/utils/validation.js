/**
 * Validation Utilities
 * Functions for validating commands, permissions, and inputs
 */

import { isPrivileged } from "./access.js";

/**
 * Validate if command can be executed
 * @returns {Promise<object>} Validation result { valid: boolean, error: string|null }
 */
export async function validateCommand(message, commandInfo, conn) {
  const result = {
    valid: true,
    error: null,
  };

  if (commandInfo.groupOnly && !message.isGroup) {
    result.valid = false;
    result.error = "GROUP_ONLY";
    return result;
  }

  // fromMe / owner commands: owner + sudo (linked devices), not only key.fromMe
  if (commandInfo.fromMe) {
    const ok = await isPrivileged(message, conn);
    if (!ok) {
      result.valid = false;
      result.error = "OWNER_ONLY";
      return result;
    }
  }

  return result;
}

export function isValidJid(jid) {
  if (!jid || typeof jid !== "string") return false;
  return jid.includes("@");
}

export function sanitizeInput(input, options = {}) {
  if (!input) return "";

  let sanitized = input.trim();

  if (options.removeControlChars) {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, "");
  }

  if (options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
  }

  return sanitized;
}

export function validateMessageContent(message, requiredTypes = []) {
  const result = {
    valid: true,
    error: null,
  };

  if (requiredTypes.includes("text") && !message.body) {
    result.valid = false;
    result.error = "⚠️ Text is required!";
    return result;
  }

  if (requiredTypes.includes("quoted") && !message.quoted) {
    result.valid = false;
    result.error = "⚠️ Please reply to a message!";
    return result;
  }

  if (requiredTypes.includes("mentions")) {
    const mentions = message.message?.contextInfo?.mentionedJid || [];
    if (mentions.length === 0) {
      result.valid = false;
      result.error = "⚠️ Please mention a user!";
      return result;
    }
  }

  return result;
}

export function isOwner(userJid, ownerJid) {
  if (!ownerJid) return false;
  const normalizeJid = (jid) => jid.split("@")[0].split(":")[0];
  return normalizeJid(userJid) === normalizeJid(ownerJid);
}

export function validateNumber(input, options = {}) {
  const result = {
    valid: false,
    value: null,
    error: null,
  };

  const num = parseInt(input);

  if (isNaN(num)) {
    result.error = "⚠️ Invalid number!";
    return result;
  }

  if (options.min !== undefined && num < options.min) {
    result.error = `⚠️ Number must be at least ${options.min}!`;
    return result;
  }

  if (options.max !== undefined && num > options.max) {
    result.error = `⚠️ Number must be at most ${options.max}!`;
    return result;
  }

  result.valid = true;
  result.value = num;
  return result;
}

