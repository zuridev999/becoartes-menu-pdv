const STATIONS = ['kitchen', 'bar'];

export const planOrderDispatch = ({ origin, dispatchTargets, presentStations = [] }) => {
  const targets = {
    kitchen: origin !== 'pdv' || dispatchTargets?.kitchen !== false,
    bar: origin !== 'pdv' || dispatchTargets?.bar !== false,
  };

  // O fluxo padrão mantém exatamente o envio atual, inclusive o aviso ao PDV.
  if (targets.kitchen && targets.bar) {
    return {
      targets,
      skippedStations: [],
      orderStatus: 'pending',
      requestStatus: 'pending',
      sentToProduction: true,
    };
  }

  const stations = STATIONS.filter(station => presentStations.includes(station));
  const activeStations = stations.filter(station => targets[station]);
  return {
    targets,
    skippedStations: stations.filter(station => !targets[station]),
    orderStatus: activeStations.length ? 'pending' : 'ready',
    requestStatus: targets.bar && activeStations.includes('bar') ? 'pending' : 'suppressed',
    sentToProduction: activeStations.length > 0,
  };
};

export const resolveOrderDispatch = async ({ origin, dispatchTargets, items, db, splitItemsByProductionStation }) => {
  if (origin !== 'pdv' || (dispatchTargets?.kitchen !== false && dispatchTargets?.bar !== false)) {
    return planOrderDispatch({ origin, dispatchTargets });
  }

  const productIds = [...new Set(items.map(item => String(item.productId)))];
  const productRows = await db.execute({
    sql: `SELECT m.id, m.name, c.name AS category_name
          FROM menu m LEFT JOIN categories c ON c.id = m.category_id
          WHERE m.id IN (${productIds.map(() => '?').join(',')})`,
    args: productIds,
  });
  const productsById = new Map(productRows.rows.map(row => [String(row.id), row]));
  const routedItems = items.map(item => ({
    ...item,
    name: productsById.get(String(item.productId))?.name || item.name,
    categoryName: productsById.get(String(item.productId))?.category_name || '',
  }));
  return planOrderDispatch({
    origin,
    dispatchTargets,
    presentStations: Object.keys(splitItemsByProductionStation(routedItems)),
  });
};
