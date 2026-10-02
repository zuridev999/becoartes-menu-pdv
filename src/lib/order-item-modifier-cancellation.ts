import { OperationalApi } from './api';
import type { AppState } from '../store';
import type { OrderItem } from '../types';

type CancelContext = {
  tableId: string;
  tableNumber: number;
  reasonCode?: string;
  reasonLabel?: string;
  reasonNotes?: string;
};

export async function cancelOrderItemModifier(
  itemId: string,
  modifierId: string,
  context: CancelContext,
  get: () => AppState,
  set: (updater: (state: AppState) => Partial<AppState>) => void,
) {
  try {
    await OperationalApi.deleteOrderItemModifier({
      itemId,
      modifierId,
      cancelContext: {
        tableNumber: context.tableNumber,
        reasonCode: context.reasonCode,
        reasonLabel: context.reasonLabel,
        reasonNotes: context.reasonNotes,
      },
    });
    const withoutModifier = (item: OrderItem) => item.id === itemId
      ? { ...item, selectedModifiers: item.selectedModifiers.filter(modifier => modifier.id !== modifierId) }
      : item;
    set(state => ({
      tables: state.tables.map(table => table.id === context.tableId
        ? { ...table, orders: table.orders.map(withoutModifier) }
        : table),
      kitchenOrders: state.kitchenOrders.map(order => ({ ...order, items: order.items.map(withoutModifier) })),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    get().addNotification(message ? `Erro ao remover adicional: ${message}` : 'Erro ao remover adicional. Tente novamente.', 'error');
    throw error;
  }
}
