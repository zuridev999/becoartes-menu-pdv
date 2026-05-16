import type { OrderItem } from '../types';

export const getModifiersTotal = (item: Pick<OrderItem, 'selectedModifiers'>) => {
  return item.selectedModifiers?.reduce((acc, modifier) => acc + Number(modifier.price || 0), 0) || 0;
};

export const getOrderItemUnitPrice = (item: Pick<OrderItem, 'price' | 'selectedModifiers'>) => {
  return Number(item.price || 0) + getModifiersTotal(item);
};

export const getOrderItemTotal = (item: Pick<OrderItem, 'price' | 'quantity' | 'selectedModifiers'>) => {
  return getOrderItemUnitPrice(item) * Number(item.quantity || 0);
};

export const getOrderItemsTotal = (items: Array<Pick<OrderItem, 'price' | 'quantity' | 'selectedModifiers'>>) => {
  return items.reduce((acc, item) => acc + getOrderItemTotal(item), 0);
};
