export const cashDenominationsCents = Object.freeze({
  note_200: 20000,
  note_100: 10000,
  note_50: 5000,
  note_20: 2000,
  note_10: 1000,
  note_5: 500,
  note_2: 200,
  coin_1: 100,
  coin_50: 50,
  coin_25: 25,
  coin_10: 10,
  coin_5: 5,
});

const invalidCount = (message) => Object.assign(new Error(message), { statusCode: 400 });

export const countCashCents = (cashCount) => {
  if (!cashCount || typeof cashCount !== 'object' || Array.isArray(cashCount)) {
    throw invalidCount('Contagem de cédulas e moedas inválida.');
  }
  // A cached copy of the previous interface may still send 1¢ as zero.
  // It is ignored; any nonzero 1¢ count must be corrected before closing.
  if ('coin_1_cent' in cashCount && cashCount.coin_1_cent !== 0) {
    throw invalidCount('A moeda de 1 centavo não faz parte da contagem.');
  }
  const normalized = { ...cashCount };
  delete normalized.coin_1_cent;
  const keys = Object.keys(normalized);
  if (keys.length !== Object.keys(cashDenominationsCents).length
    || keys.some(key => !(key in cashDenominationsCents))) {
    throw invalidCount('Informe a quantidade de cada cédula e moeda.');
  }
  let total = 0;
  for (const [key, denomination] of Object.entries(cashDenominationsCents)) {
    const quantity = normalized[key];
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 10000) {
      throw invalidCount(`Quantidade inválida para ${key}.`);
    }
    total += quantity * denomination;
  }
  if (!Number.isSafeInteger(total)) throw invalidCount('Total de caixa inválido.');
  return total;
};
