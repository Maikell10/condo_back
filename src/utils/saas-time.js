/** Horas a sumar a UTC para calendario SaaS (default 6, configurable en env). */
const SAAS_TZ_OFFSET_HOURS = Number(process.env.SAAS_TZ_OFFSET_HOURS ?? 6);

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Partes de calendario “de negocio” sin usar toISOString (evita corrimiento de día).
 */
const getSaasCalendarParts = (date = new Date()) => {
    const shifted = new Date(
        date.getTime() + SAAS_TZ_OFFSET_HOURS * 60 * 60 * 1000,
    );
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();
    return {
        year,
        month,
        day,
        ymd: `${year}-${pad2(month)}-${pad2(day)}`,
        issueDateYmd: `${year}-${pad2(month)}-01`,
    };
};

/** due_date = día 1 del mes + due_days (ej. due_days 5 → día 6). */
const saasDueDateYmd = (year, month, dueDays) => {
    const day = 1 + Math.max(0, Number(dueDays) || 0);
    return `${year}-${pad2(month)}-${pad2(day)}`;
};

module.exports = {
    SAAS_TZ_OFFSET_HOURS,
    getSaasCalendarParts,
    saasDueDateYmd,
};
