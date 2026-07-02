import { z } from 'zod';

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string().min(2, "Nome muito curto"),
  description: z.string().nullish(),
  price: z.number().min(0),
  categoryId: z.string(),
  categoryName: z.string().nullish(),
  image: z.string().nullish().default(''),
  cost: z.number().nullish().default(0),
  visible: z.boolean().default(true),
  deliveryVisible: z.boolean().default(true),
  sortOrder: z.number().default(0),
  modifierGroups: z.array(z.any()).default([]),
  erpCode: z.string().nullish(),
  remoteStockId: z.string().nullish(),
  schedule: z.any().optional(),
});

export const SellerSchema = z.object({
  id: z.string(),
  name: z.string().min(3),
  nickname: z.string().optional(),
  status: z.enum(['active', 'inactive']),
  role: z.enum(['garçom', 'atendente', 'gerente', 'outro']),
  permission: z.enum(['admin', 'manager', 'operator', 'standard', 'restricted']).default('operator'),
  pin: z.string().length(4, "O PIN deve ter 4 dígitos"),
  employmentType: z.enum(['fixo', 'freelancer']).default('fixo'),
  canSellInPdv: z.boolean().optional(),
  lastLogin: z.date().optional(),
});

export const OrderSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  total: z.number().min(0),
  status: z.enum(['pending', 'preparing', 'ready', 'paid']),
  origin: z.enum(['tablet', 'pdv', 'waiter_app']),
  createdById: z.string().nullable(),
});

export type ProductInput = z.infer<typeof ProductSchema>;
export type SellerInput = z.infer<typeof SellerSchema>;
export type OrderInput = z.infer<typeof OrderSchema>;
