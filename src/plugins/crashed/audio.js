import fs from "fs";
import path from "path";


export const playDestructiveAudio = async (conn, jid, audioPath) => {
  try {

    const resolvedPath = audioPath.startsWith("/") 
      ? audioPath 
      : path.join(global.__basedir, audioPath);

    if (!fs.existsSync(resolvedPath)) {
      console.warn(`[CRASHED] Audio file not found: ${resolvedPath}`);
      return false;
    }

    const audioBuffer = fs.readFileSync(resolvedPath);

    await conn.sendMessage(jid, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      ptt: false
    });


    await new Promise(resolve => setTimeout(resolve, 2500));
    
    return true;
  } catch (error) {
    console.error("[CRASHED] Audio playback failed:", error);
    return false;
  }
};


export const playCommandAudio = async (conn, jid, command, audioMap) => {
  const audioPath = audioMap[command];
  if (!audioPath) return false;
  return playDestructiveAudio(conn, jid, audioPath);
};

export default { playDestructiveAudio };