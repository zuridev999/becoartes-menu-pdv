import { z } from 'zod';

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string().min(2, "Nome muito curto"),
  description: z.string().optional(),
  price: z.number().min(0),
  categoryId: z.string(),
  categoryName: z.string().optional(),
  image: z.string().url("URL de imagem inválida"),
  visible: z.boolean().default(true),
  modifierGroups: z.array(z.any()).default([]),
  erpCode: z.string().optional(),
  remoteStockId: z.string().optional(),
  schedule: z.any().optional(),
});

export const SellerSchema = z.object({
  id: z.string(),
  name: z.string().min(3),
  nickname: z.string().optional(),
  status: z.enum(['active', 'inactive']),
  role: z.enum(['garçom', 'atendente', 'gerente', 'outro']),
  permission: z.enum(['admin', 'standard', 'restricted']).default('standard'),
  pin: z.string().length(4, "O PIN deve ter 4 dígitos"),
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
