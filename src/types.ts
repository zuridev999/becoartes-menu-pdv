export interface ScheduleDay {
  active: boolean;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

export interface ScheduleConfig {
  enabled: boolean;
  days: {
    [key: number]: ScheduleDay; // 0-6 (Dom-Sab)
  };
  hideTotally: boolean; // false = mostrar como indisponível
  message?: string;
}

export interface Category {
  id: string;
  name: string;
  schedule?: ScheduleConfig;
  sortOrder: number;
  visible: boolean;
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
  status: 'active' | 'inactive';
}

export interface ModifierGroup {
  id: string;
  name: string;
  description?: string;
  minChoices: number;
  maxChoices: number;
  isRequired: boolean;
  status: 'active' | 'inactive';
  modifiers: Modifier[];
}

export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  categoryId: string;
  categoryName?: string; // Para compatibilidade e facilidade
  image: string;
  visible: boolean;
  schedule?: ScheduleConfig;
  modifierGroups: ModifierGroup[];
  erpCode?: string;
  remoteStockId?: string;
  cost?: number;
}

export interface OrderItem {
  id: string; // Unique ID for this item in the cart
  orderId?: string;
  productId: string;
  categoryId?: string;
  categoryName?: string;
  name: string;
  price: number;
  quantity: number;
  selectedModifiers: Modifier[];
  remoteStockId?: string;
  notes?: string;
  orderedAt?: Date;
  status?: 'pending' | 'preparing' | 'ready' | 'delivered';
}

export interface Table {
  id: string;
  number: number;
  status: 'available' | 'ordering' | 'waiting' | 'paid' | 'bill_requested';
  orders: OrderItem[];
  cart: OrderItem[];
  capacity?: number;
  lastActivity?: Date;
  currentSellerId?: string;
}

export interface KitchenOrder {
  id: string;
  tableId: string;
  tableNumber: number;
  items: OrderItem[];
  status: 'pending' | 'preparing' | 'ready';
  createdAt: Date;
  origin: 'tablet' | 'pdv' | 'qr';
  chefNotes?: string;
}

export interface ServiceRequest {
  id: string;
  tableId: string;
  tableNumber: number;
  type: string; // 'waiter' | 'bill' | 'glass' | 'cutlery' | 'napkin' | 'ice' | 'lemon' | 'physical_menu' | 'help' | 'problem' | 'other'
  message?: string;
  status: 'pending' | 'viewed' | 'resolved';
  createdAt: Date;
}

export interface ClosedBill {
  id: string;
  tableId: string;
  tableNumber: number;
  sellerId: string;
  sellerName: string;
  subtotal: number;
  serviceFee: number;
  discount: number;
  discountReason?: string;
  total: number;
  payments: Array<{
    method: 'credit' | 'debit' | 'cash' | 'pix';
    amount: number;
  }>;
  closedAt: Date;
}

export interface Seller {
  id: string;
  name: string;
  nickname?: string;
  pin: string;
  lastLogin?: Date;
  status: 'active' | 'inactive';
  role: 'garçom' | 'atendente' | 'gerente' | 'outro';
  permission: 'admin' | 'manager' | 'operator' | 'standard' | 'restricted';
  source?: 'pdv' | 'os';
  osUserId?: string;
  email?: string;
  allowRemote?: boolean;
}

export interface AppSettings {
  unitName: string;
  currency: string;
  serviceTax: number;
  permissionProfiles?: Record<string, Record<string, boolean>>;
  tablet: {
    bannerUrls: string[];
    bannerText: string;
    autoBanner: boolean;
    inactivityTimeout: number;
    viewMode: 'grid' | 'list';
    sendToKitchenOnFinish: boolean;
  };
  kitchen: {
    showTable: boolean;
    visualAlert: boolean;
    soundAlert: boolean;
  };
}
