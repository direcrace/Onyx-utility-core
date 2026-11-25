const FOOTER = "Onyx | Community edition";
const PATCHED = Symbol.for("onyx.messageFooterPatched");

function withFooter(value) {
  if (typeof value !== "string" || !value.trim()) return value;
  const trimmed = value.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
  if (trimmed.includes(FOOTER)) return trimmed;
  return `${trimmed}\n\n${FOOTER}`;
}

export function footerizePayload(content) {
  if (content == null) return content;

  if (typeof content === "string") {
    return withFooter(content);
  }

  if (typeof content !== "object" || Array.isArray(content)) {
    return content;
  }

  const next = { ...content };
  if (typeof next.text === "string") next.text = withFooter(next.text);
  if (typeof next.caption === "string") next.caption = withFooter(next.caption);
  if (typeof next.extendedTextMessage?.text === "string") {
    next.extendedTextMessage = {
      ...next.extendedTextMessage,
      text: withFooter(next.extendedTextMessage.text),
    };
  }
  return next;
}

export function attachMessageFooter(conn) {
  if (!conn || typeof conn.sendMessage !== "function" || conn[PATCHED]) return conn;

  const original = conn.sendMessage;
  const wrapped = async function (...args) {
    if (args.length > 1) args[1] = footerizePayload(args[1]);
    return Reflect.apply(original, this, args);
  };

  Object.defineProperty(wrapped, PATCHED, { value: true });
  try {
    conn.sendMessage = wrapped;
    Object.defineProperty(conn, PATCHED, { value: true, configurable: true });
  } catch {
    // Never let branding break a connection if the socket object is locked.
    return conn;
  }
  return conn;
}

export const MESSAGE_FOOTER = FOOTER;
