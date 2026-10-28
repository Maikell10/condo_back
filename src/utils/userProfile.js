const normalizeOptionalText = (value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
};

const normalizeCedula = (value) => {
    const raw = normalizeOptionalText(value);
    if (!raw) return null;
    const match = raw.match(/^([VE])[-.]?(\d+)$/i);
    if (match) {
        return `${match[1].toUpperCase()}${match[2]}`;
    }
    const digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    return `V${digits}`;
};

const normalizePhoneVe = (value) => {
    const raw = normalizeOptionalText(value);
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) {
        return `+58${digits}`;
    }
    if (digits.startsWith("58") && digits.length === 12) {
        return `+${digits}`;
    }
    if (/^\+58\d{10}$/.test(raw.replace(/\s/g, ""))) {
        return raw.replace(/\s/g, "");
    }
    return raw;
};

const normalizeSex = (value) => {
    const s = normalizeOptionalText(value);
    if (!s) return null;
    const u = s.toUpperCase();
    if (u === "M" || u === "F") return u;
    return null;
};

const normalizeBirthDate = (value) => {
    const d = normalizeOptionalText(value);
    if (!d) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return d;
};

module.exports = {
    normalizeOptionalText,
    normalizeCedula,
    normalizePhoneVe,
    normalizeSex,
    normalizeBirthDate,
};
