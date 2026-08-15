const normalizeIssueName = (value) => String(value || 'Item').trim().replace(/\s+/g, ' ');

const parseIssue = (raw) => {
  const text = String(raw || '').trim();
  const open = text.indexOf(' (');
  const name = normalizeIssueName(open >= 0 ? text.slice(0, open) : text.replace(/^\d+(?:[.,]\d+)?x\s*/i, ''));
  const details = open >= 0 ? text.slice(open + 2, -1) : '';
  const unitMatch = details.match(/unidade incompatível:\s*([^;]+?)\s*->\s*([^;]+)/i);
  const amountMatch = details.match(/baixa não realizada:\s*([\d.,]+)\s*([A-Z]+)/i);
  const cause = /unidade incompatível|conversão/i.test(details)
    ? 'conversion'
    : /CMV sem ingrediente|sem vínculo/i.test(details)
      ? 'missing_link'
      : /sincroniza/i.test(details)
        ? 'sync'
        : 'missing_link';
  return {
    name,
    cause,
    fromUnit: unitMatch?.[1]?.trim().toUpperCase() || '',
    toUnit: unitMatch?.[2]?.trim().toUpperCase() || '',
    amount: amountMatch ? Number(amountMatch[1].replace(',', '.')) || 0 : 0,
    amountUnit: amountMatch?.[2]?.trim().toUpperCase() || '',
  };
};

export const summarizeInventoryAttention = (issues = [], tableNumber = '') => {
  const groups = new Map();
  for (const issue of issues) {
    const parsed = parseIssue(issue);
    const key = [parsed.name, parsed.cause, parsed.fromUnit, parsed.toUnit, parsed.amountUnit].join('|');
    const current = groups.get(key) || { ...parsed, count: 0, amount: 0 };
    current.count += 1;
    current.amount += parsed.amount;
    groups.set(key, current);
  }

  const rows = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const onlyConversion = rows.length > 0 && rows.every((row) => row.cause === 'conversion');
  const title = onlyConversion ? 'Conversão de estoque pendente no PDV' : 'Baixa de estoque pendente no PDV';
  const details = rows.slice(0, 8).map((row) => {
    if (row.cause === 'conversion') {
      const amount = row.amount > 0 ? `; ${Number(row.amount.toFixed(4))} ${row.amountUnit} não baixados` : '';
      return `${row.name}: ${row.count} ocorrência(s), converter ${row.fromUnit} para ${row.toUnit}${amount}`;
    }
    if (row.cause === 'sync') return `${row.name}: sincronização indisponível (${row.count} ocorrência(s))`;
    return `${row.name}: vínculo de estoque ausente (${row.count} ocorrência(s))`;
  });
  const overflow = rows.length > 8 ? `; mais ${rows.length - 8} item(ns)` : '';
  return {
    title,
    message: `Mesa ${tableNumber}: a venda foi registrada, mas a baixa não ocorreu. ${details.join('; ')}${overflow}.`,
    groups: rows,
  };
};
