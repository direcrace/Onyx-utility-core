
export function parsedJid(text = "") {
    return [...text.matchAll(/([0-9]{5,16}|0)/g)].map(
        (v) => v[1] + "@s.whatsapp.net"
    );
}

export function isPnUser(jid) {
    return jid?.endsWith("@s.whatsapp.net");
}

export function isLidUser(jid) {
    return jid?.endsWith("@lid");
}

export function isGroup(jid) {
    return jid?.endsWith("@g.us");
}
