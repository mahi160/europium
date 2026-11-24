import { z } from 'zod';
import { publicUserSchema } from '@office-service/shared';

export const userResponse = z.object({ user: publicUserSchema });
export const sessionResponse = z.object({ user: publicUserSchema.nullable() });
export const usersResponse = z.object({ users: z.array(publicUserSchema) });
export const setupResponse = z.object({ setupRequired: z.boolean() });
export const successResponse = z.object({ success: z.literal(true) });
const errorResponse = z.object({ error: z.object({ code: z.string() }) });
export class ApiError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (method !== 'GET' && !navigator.onLine) throw new ApiError('NETWORK_ERROR');
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR');
  }
  if (!response.ok) {
    const parsed = errorResponse.safeParse(await response.json().catch(() => null));
    throw new ApiError(parsed.success ? parsed.data.error.code : 'INTERNAL_ERROR', response.status);
  }
  return schema.parse(await response.json());
}
