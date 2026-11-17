

export async function getLIDFromPN(conn, phoneNumbers) {
    try {
        if (!conn?.signalRepository?.lidMapping) {
            console.warn('LID mapping not available in connection');
            return null;
        }

        if (Array.isArray(phoneNumbers)) {
            return await conn.signalRepository.lidMapping.getLIDsForPNs(phoneNumbers);
        } else {
            return await conn.signalRepository.lidMapping.getLIDForPN(phoneNumbers);
        }
    } catch (error) {
        console.error('Error getting LID from PN:', error);
        return null;
    }
}

export async function getPNFromLID(conn, lid) {
    try {
        if (!conn?.signalRepository?.lidMapping) {
            console.warn('LID mapping not available in connection');
            return null;
        }

        return await conn.signalRepository.lidMapping.getPNForLID(lid);
    } catch (error) {
        console.error('Error getting PN from LID:', error);
        return null;
    }
}

export function getPreferredIdentifier(messageKey) {

    if (messageKey.participant) {
        return messageKey.participant;
    }

    return messageKey.remoteJid;
}

export function getPhoneNumber(messageKey, isGroup = false) {
    if (isGroup) {

        return messageKey.participantAlt || messageKey.participant;
    } else {

        return messageKey.remoteJidAlt || messageKey.remoteJid;
    }
}

export function isLID(identifier) {
    return identifier?.endsWith('@lid');
}

export function isPN(identifier) {
    return identifier?.endsWith('@s.whatsapp.net');
}

export function normalizeUserIdentifier(messageKey, isGroup = false) {
    const phoneNumber = getPhoneNumber(messageKey, isGroup);

    if (isPN(phoneNumber)) {
        return phoneNumber;
    }

    return getPreferredIdentifier(messageKey);
}
