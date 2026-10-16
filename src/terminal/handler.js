let connection = null;

export function setConnection(conn) {
  connection = conn;
}

let signalHandlersInstalled = false;
let shuttingDown = false;

export async function gracefulShutdown(signal = "manual", exitCode = 0) {
  if (shuttingDown) return false;
  shuttingDown = true;
  console.log(`\n👋 ${signal} received — shutting down...`);
  try {
    if (connection) await connection.end();
    else console.log("[shutdown] no active connection to close");
  } catch (err) {
    console.warn(`[shutdown] connection.end failed: ${err?.message || err}`);
    exitCode = exitCode || 1;
  }
  process.exit(exitCode);
  return true;
}

export function installSignalHandlers(conn) {
  if (conn && !connection) connection = conn;
  if (signalHandlersInstalled) return false;
  signalHandlersInstalled = true;

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
  return true;
}
