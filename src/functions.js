/**
 * Parse phone numbers from text and return as WhatsApp identifiers
 * Updated for Baileys 7.x.x - returns both PN and LID formats
 * @param {string} text - Text containing phone numbers
 * @returns {string[]} Array of phone number JIDs (PNs)
 */
export function parsedJid(text = "") {
    return [...text.matchAll(/([0-9]{5,16}|0)/g)].map(
        (v) => v[1] + "@s.whatsapp.net"
    );
}

/**
 * Check if a JID is a phone number (PN) format
 * Replaces the deprecated isJidUser from Baileys 6.x
 * @param {string} jid - The JID to check
 * @returns {boolean} True if it's a PN format
 */
export function isPnUser(jid) {
    return jid?.endsWith("@s.whatsapp.net");
}

/**
 * Check if a JID is a LID (Local Identifier) format
 * @param {string} jid - The JID to check
 * @returns {boolean} True if it's a LID format
 */
export function isLidUser(jid) {
    return jid?.endsWith("@lid");
}

/**
 * Check if a JID is a group
 * @param {string} jid - The JID to check
 * @returns {boolean} True if it's a group
 */
export function isGroup(jid) {
    return jid?.endsWith("@g.us");
}
