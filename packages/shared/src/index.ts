import { z } from 'zod';
export * from './notifications';

export const roleSchema = z.enum(['employee', 'staff', 'admin']);
export const languageSchema = z.enum(['bn', 'en']);
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9_]+$/);
export const passwordSchema = z.string().min(12).max(128);
export const pinSchema = z
  .string()
  .length(4)
  .regex(/^[0-9]{4}$/);
const credentialSchema = z.union([passwordSchema, pinSchema]);
const nameSchema = z.string().trim().min(1).max(100);
const locationSchema = z.string().trim().max(100);

export const profileSchema = z.strictObject({
  name: nameSchema,
  language: languageSchema,
  floor: locationSchema,
  desk: locationSchema,
});
export const setupSchema = profileSchema.extend({
  username: usernameSchema,
  password: passwordSchema,
  setupToken: z.string().min(32).max(256),
});
export const loginSchema = z.strictObject({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});
export const createUserSchema = profileSchema
  .extend({
    username: usernameSchema,
    password: credentialSchema.default('0000'),
    role: roleSchema,
  })
  .refine(
    (value) =>
      (value.role === 'admin' ? passwordSchema : pinSchema).safeParse(value.password).success,
  );
export const updateUserSchema = profileSchema
  .extend({
    role: roleSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
// Delivery location is assigned by administrators, not self-edited.
export const updateProfileSchema = profileSchema
  .omit({ floor: true, desk: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(128),
    newPassword: credentialSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword);
export const resetPasswordSchema = z.strictObject({ newPassword: credentialSchema });
export const userIdSchema = z.string().min(1).max(128);
export const publicUserSchema = z.object({
  ...profileSchema.shape,
  id: userIdSchema,
  username: usernameSchema,
  role: roleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
});
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'INVALID_CREDENTIALS',
  'INVALID_CURRENT_PASSWORD',
  'CREDENTIAL_UNCHANGED',
  'SETUP_COMPLETE',
  'INVALID_SETUP_TOKEN',
  'USERNAME_TAKEN',
  'USER_NOT_FOUND',
  'LAST_ACTIVE_ADMIN',
  'INVALID_ORIGIN',
  'BODY_TOO_LARGE',
  'RATE_LIMITED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'ITEM_UNAVAILABLE',
  'IDEMPOTENCY_MISMATCH',
  'ORDER_NOT_PENDING',
  'ORDER_CONFLICT',
]);
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: apiErrorCodeSchema }),
});

export const menuCategories = ['tea', 'coffee', 'water', 'snack'] as const;
export const menuCategorySchema = z.enum(menuCategories);
export const menuInputSchema = z.strictObject({
  name: nameSchema,
  category: menuCategorySchema,
  unit: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/[\u0980-\u09ff]/),
  available: z.boolean(),
  archived: z.boolean(),
});
export const menuItemSchema = z.object({ ...menuInputSchema.shape, id: z.uuid() });
export const menuResponseSchema = z.object({ items: z.array(menuItemSchema) });
export const menuItemResponseSchema = z.object({ item: menuItemSchema });
export const orderStatuses = ['PENDING', 'ACCEPTED', 'DELIVERED', 'REJECTED', 'CANCELLED'] as const;
export const orderStatusSchema = z.enum(orderStatuses);
export const orderItemInputSchema = z.strictObject({
  itemId: z.uuid(),
  quantity: z.number().int().positive(),
});
export const orderPayloadSchema = z.strictObject({
  items: z
    .array(orderItemInputSchema)
    .min(1)
    .refine((items) => new Set(items.map((item) => item.itemId)).size === items.length),
  note: z.string().trim().max(500),
});
export const createOrderSchema = orderPayloadSchema.extend({ idempotencyKey: z.uuid() });
export const cancelOrderSchema = z.strictObject({ reason: z.string().trim().max(500) });
export const requeueOrderSchema = z.strictObject({
  reason: cancelOrderSchema.shape.reason.optional(),
});
export const orderActions = ['create', 'accept', 'deliver', 'reject', 'cancel', 'requeue'] as const;
export const orderActionSchema = z.enum(orderActions);
export const transitionReasonSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const emptyCommandSchema = z.strictObject({});
const orderPersonSchema = z.object({ id: userIdSchema, name: z.string() });
export const orderAuditSchema = z.object({
  id: z.number().int(),
  action: orderActionSchema,
  actor: orderPersonSchema,
  at: z.number(),
  fromStatus: orderStatusSchema.nullable(),
  toStatus: orderStatusSchema,
  fromAssigneeId: userIdSchema.nullable(),
  assignee: orderPersonSchema.nullable(),
  reason: z.string().nullable(),
});
export const orderSchema = z.object({
  id: z.uuid(),
  userId: userIdSchema,
  status: orderStatusSchema,
  floor: locationSchema,
  desk: locationSchema,
  note: z.string(),
  reason: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  assignee: orderPersonSchema.nullable(),
  acceptedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  audit: z.array(orderAuditSchema),
  items: z.array(
    z.object({
      itemId: z.uuid(),
      name: z.string(),
      unit: z.string(),
      quantity: z.number().int().positive(),
    }),
  ),
});
export const orderResponseSchema = z.object({ order: orderSchema });
export const ordersResponseSchema = z.object({ orders: z.array(orderSchema) });
export const personalOrdersResponseSchema = ordersResponseSchema.extend({
  lastOrder: orderSchema.nullable(),
});
export type MenuInput = z.infer<typeof menuInputSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type OrderPayload = z.infer<typeof orderPayloadSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderAction = z.infer<typeof orderActionSchema>;
export type MenuResponse = z.infer<typeof menuResponseSchema>;
export type MenuItemResponse = z.infer<typeof menuItemResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type OrdersResponse = z.infer<typeof ordersResponseSchema>;
export type PersonalOrdersResponse = z.infer<typeof personalOrdersResponseSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export type Role = z.infer<typeof roleSchema>;
export type Language = z.infer<typeof languageSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type UserResponse = { user: PublicUser };
export type SessionResponse = { user: PublicUser | null };
export type UsersResponse = { users: PublicUser[] };
export type SetupStatusResponse = { setupRequired: boolean };
export type SuccessResponse = { success: true };
