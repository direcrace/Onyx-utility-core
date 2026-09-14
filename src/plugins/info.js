/**
 * Info Command
 * Shows detailed message and user information (Baileys 7.x.x compatible)
 */

import { command } from "../plugins.js";
import { reply, tr } from "../utils/message.js";
import { isPnUser, isLidUser, isGroup } from "../functions.js";

command(
    {
        pattern: "info",
        fromMe: false,
        desc: "Shows user and message information",
        type: "misc",
    },
    async (message, conn) => {
        try {
            const L = (en, de) => tr(en, de);
            let info = await L("📱 *Message Information*\n\n", "📱 *Nachrichten-Information*\n\n");
            
            // Chat Information
            info += await L(`*Chat Type:* ${message.isGroup ? "Group" : "Direct Message"}\n`, `*Chat-Typ:* ${message.isGroup ? "Gruppe" : "Direktnachricht"}\n`);
            info += `*Chat ID:* ${message.from}\n`;
            
            // Show alternate identifier if available
            if (message.fromAlt) {
                info += `*Chat ID (Alt):* ${message.fromAlt}\n`;
            }
            
            // Sender Information
            info += await L(`\n*Sender:* ${message.pushName || "Unknown"}\n`, `\n*Absender:* ${message.pushName || "Unbekannt"}\n`);
            info += `*Sender ID:* ${message.participant}\n`;
            
            // Show alternate participant if available
            if (message.participantAlt) {
                info += `*Sender ID (Alt):* ${message.participantAlt}\n`;
            }
            
            // Show the preferred identifier
            info += `*Preferred ID:* ${message.sender}\n`;
            
            // Identifier Type Detection
            const senderType = isLidUser(message.participant) 
                ? "LID (Local Identifier)" 
                : isPnUser(message.participant) 
                ? "PN (Phone Number)" 
                : "Unknown";
            info += await L(`*ID Type:* ${senderType}\n`, `*ID-Typ:* ${senderType}\n`);
            
            // Message Details
            info += await L(`\n*Message Type:* ${message.type}\n`, `\n*Nachrichtentyp:* ${message.type}\n`);
            info += `*Message ID:* ${message.id}\n`;
            
            // Show quoted message if exists
            if (message.quoted) {
                info += await L(`*Quoted:* Yes\n`, `*Zitiert:* Ja\n`);
            }
            
            // Group-specific information
            if (message.isGroup) {
                try {
                    const groupMetadata = await conn.groupMetadata(message.from);
                    info += await L(`\n*Group Name:* ${groupMetadata.subject}\n`, `\n*Gruppenname:* ${groupMetadata.subject}\n`);
                    info += await L(`*Participants:* ${groupMetadata.participants.length}\n`, `*Teilnehmer:* ${groupMetadata.participants.length}\n`);
                    
                    // In Baileys 7.x, group metadata has LID+PN pairs
                    if (groupMetadata.owner) {
                        info += `*Owner ID:* ${groupMetadata.owner}\n`;
                    }
                    if (groupMetadata.ownerPn) {
                        info += `*Owner PN:* ${groupMetadata.ownerPn}\n`;
                    }
                } catch (error) {
                    info += await L(`\n_Could not fetch group metadata_\n`, `\n_Gruppenmetadaten konnten nicht abgerufen werden_\n`);
                }
            }
            
            // Send the information
            await reply(conn, message, info);
            
        } catch (error) {
            console.error("Error in info command:", error);
            await reply(conn, message, await tr("❌ Failed to get information.", "❌ Informationen konnten nicht abgerufen werden."));
        }
    }
);
