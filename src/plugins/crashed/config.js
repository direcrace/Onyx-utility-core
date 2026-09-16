import dotenv from "dotenv";

dotenv.config();

const config = {

  WHITELIST: (process.env.CRASHED_WHITELIST || "").split(",").filter(Boolean).map(id => id.trim()),
  

  COMMAND_AUDIO: {
    nuke: process.env.CRASHED_AUDIO_NUKE || "./assets/dms.mp3",
    take: process.env.CRASHED_AUDIO_TAKE || "./assets/take.mp3",
    setcom: process.env.CRASHED_AUDIO_SETCOM || "./assets/dms.mp3",
    setloggroup: process.env.CRASHED_AUDIO_SETLOG || "./assets/dms.mp3",
    groupinfo: process.env.CRASHED_AUDIO_GROUPINFO || "./assets/dms.mp3"
  },
  

  AUDIO_COMMANDS: [
    "nuke",
    "take",
    "setcom",
    "setloggroup",
    "groupinfo"
  ],
  

  ALL_COMMANDS: [
    "ping",
    "menu",
    "ip",
    "ipsafe",
    "listgroups",
    "listcoms",
    "setcom",
    "setloggroup",
    "nuke",
    "selfpromote",
    "take",
    "seetaken",
    "groupinfo",
    "blacklist"
  ]
};

export default config;