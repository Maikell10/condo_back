/**
 * Reparte un monto en centavos según pesos (método del resto mayor).
 * weights: números positivos (p.ej. 1 por edificio, o cantidad de aptos).
 */
function allocateByWeights(totalAmount, weights) {
    const totalCents = Math.round(Number(totalAmount) * 100);
    const list = (weights || []).map((w) => Number(w) || 0);
    if (list.length === 0) return [];

    const weightSum = list.reduce((sum, w) => sum + w, 0);
    if (weightSum <= 0) {
        const even = Math.floor(totalCents / list.length);
        const shares = list.map(() => even);
        shares[shares.length - 1] += totalCents - even * list.length;
        return shares.map((cents) => cents / 100);
    }

    const raw = list.map((w) => (totalCents * w) / weightSum);
    const floors = raw.map((x) => Math.floor(x));
    let leftover = totalCents - floors.reduce((sum, n) => sum + n, 0);
    const fracOrder = raw
        .map((x, i) => ({ i, frac: x - Math.floor(x) }))
        .sort((a, b) => b.frac - a.frac);

    for (let k = 0; k < leftover; k++) {
        floors[fracOrder[k].i] += 1;
    }

    return floors.map((cents) => cents / 100);
}

module.exports = { allocateByWeights };
