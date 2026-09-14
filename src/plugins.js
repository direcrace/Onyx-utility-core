/**
 * Command Registry and Builder
 * Manages command registration and pattern matching
 */

import { BOT_INFO } from "./config/constants.js";

const commands = [];
/** First-token → command index for O(1)-ish lookup */
const commandIndex = new Map();

/** Build a command match regex for a given prefix + command name. */
function buildPattern(prefix, name) {
  return new RegExp(`(${prefix})( ?${name}(?=\\b|$))(.*)`, "is");
}

/**
 * Command builder class for fluent API
 */
class CommandBuilder {
  constructor() {
    this.config = {
      pattern: null,
      patternName: null,
      fromMe: false,
      desc: "",
      type: "misc",
      groupOnly: false,
      adminOnly: false,
      botAdminRequired: false,
      dontAddCommandList: false,
      function: null,
    };
  }

  setPattern(pattern) {
    this.config.patternName = pattern;
    this.config.pattern = buildPattern(BOT_INFO.PREFIX, pattern);
    return this;
  }

  setDescription(desc) {
    this.config.desc = desc;
    return this;
  }

  setType(type) {
    this.config.type = type;
    return this;
  }

  setFromMe(fromMe = true) {
    this.config.fromMe = fromMe;
    return this;
  }

  setGroupOnly(groupOnly = true) {
    this.config.groupOnly = groupOnly;
    return this;
  }

  setAdminOnly(adminOnly = true) {
    this.config.adminOnly = adminOnly;
    return this;
  }

  setBotAdminRequired(required = true) {
    this.config.botAdminRequired = required;
    return this;
  }

  setFunction(func) {
    this.config.function = func;
    return this;
  }

  build() {
    if (!this.config.pattern || !this.config.function) {
      throw new Error("Pattern and function are required for command");
    }
    commands.push(this.config);
    if (this.config.patternName) {
      const key = this.config.patternName.toLowerCase();
      // First registered wins for index; regex fallback still finds later ones
      if (!commandIndex.has(key)) {
        commandIndex.set(key, this.config);
      }
    }
    return this.config;
  }
}

/**
 * Register a command
 */
export const command = (commandInfo, func) => {
  const builder = new CommandBuilder();

  if (commandInfo.pattern) {
    builder.setPattern(commandInfo.pattern);
  }
  if (commandInfo.desc) {
    builder.setDescription(commandInfo.desc);
  }
  if (commandInfo.type) {
    builder.setType(commandInfo.type);
  }
  if (commandInfo.fromMe) {
    builder.setFromMe(commandInfo.fromMe);
  }
  if (commandInfo.groupOnly) {
    builder.setGroupOnly(commandInfo.groupOnly);
  }
  if (commandInfo.adminOnly) {
    builder.setAdminOnly(commandInfo.adminOnly);
  }
  if (commandInfo.botAdminRequired) {
    builder.setBotAdminRequired(commandInfo.botAdminRequired);
  }
  if (commandInfo.dontAddCommandList) {
    builder.config.dontAddCommandList = commandInfo.dontAddCommandList;
  }

  builder.setFunction(func);

  return builder.build();
};

export function getCommands() {
  return commands;
}

export function getCommandsByType(type) {
  return commands.filter((cmd) => cmd.type === type);
}

/**
 * Extract first token after prefix for index lookup
 */
function extractCommandToken(text) {
  if (!text) return null;
  const prefix = BOT_INFO.PREFIX;
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length).trimStart();
  const match = rest.match(/^(\S+)/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Find command by pattern match (index first, then regex scan)
 */
export function findCommand(text) {
  const token = extractCommandToken(text);
  if (token) {
    const indexed = commandIndex.get(token);
    if (indexed && indexed.pattern.test(text)) {
      return indexed;
    }
  }
  return commands.find((cmd) => cmd.pattern && cmd.pattern.test(text)) || null;
}

/**
 * Commands for menu (respects dontAddCommandList)
 */
export function getMenuCommands() {
  return commands.filter((cmd) => !cmd.dontAddCommandList && cmd.patternName);
}

/**
 * Recompile every registered command's match regex with the current prefix.
 * Call after a runtime prefix change (and optionally after loadRuntimeConfig).
 */
export function rebuildCommandPatterns() {
  for (const cmd of commands) {
    if (cmd.patternName) {
      cmd.pattern = buildPattern(BOT_INFO.PREFIX, cmd.patternName);
    }
  }
  return commands.length;
}

export { commands, CommandBuilder, commandIndex };
