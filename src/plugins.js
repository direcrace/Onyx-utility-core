

import { BOT_INFO } from "./config/constants.js";

const commands = [];

const commandIndex = new Map();

function buildPattern(prefix, name) {
  return new RegExp(`(${prefix})( ?${name}(?=\\b|$))(.*)`, "is");
}

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

      if (!commandIndex.has(key)) {
        commandIndex.set(key, this.config);
      }
    }
    return this.config;
  }
}

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

function extractCommandToken(text) {
  if (!text) return null;
  const prefix = BOT_INFO.PREFIX;
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length).trimStart();
  const match = rest.match(/^(\S+)/);
  return match ? match[1].toLowerCase() : null;
}

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

export function getMenuCommands() {
  return commands.filter((cmd) => !cmd.dontAddCommandList && cmd.patternName);
}

export function rebuildCommandPatterns() {
  for (const cmd of commands) {
    if (cmd.patternName) {
      cmd.pattern = buildPattern(BOT_INFO.PREFIX, cmd.patternName);
    }
  }
  return commands.length;
}

export { commands, CommandBuilder, commandIndex };
