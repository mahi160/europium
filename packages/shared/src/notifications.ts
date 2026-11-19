import { z } from 'zod';

export const notificationResources = {
  bn: {
    app: 'অফিস সেবা', create: 'নতুন অনুরোধ অপেক্ষমাণ', reminder: 'অনুরোধ এখনও অপেক্ষমাণ',
    accept: 'আপনার অনুরোধ গ্রহণ করা হয়েছে', deliver: 'আপনার অনুরোধ পৌঁছে দেওয়া হয়েছে',
    reject: 'আপনার অনুরোধ প্রত্যাখ্যান করা হয়েছে', cancel: 'আপনার অনুরোধ বাতিল করা হয়েছে',
    requeue: 'আপনার অনুরোধ আবার অপেক্ষমাণ', reason: 'কারণ', open: 'অনুরোধ দেখতে খুলুন',
  },
  en: {
    app: 'Office Service', create: 'New request pending', reminder: 'Request still pending',
    accept: 'Your request was accepted', deliver: 'Your request was delivered',
    reject: 'Your request was rejected', cancel: 'Your request was cancelled',
    requeue: 'Your request is pending again', reason: 'Reason', open: 'Open to view your request',
  },
};
export const notificationKindSchema = z.enum(['create', 'reminder', 'accept', 'deliver', 'reject', 'cancel', 'requeue']);
export const notificationPayloadSchema = z.strictObject({
  language: z.enum(['bn', 'en']), kind: notificationKindSchema,
  target: z.string().regex(/^\/(orders|work)\?order=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  reason: z.string().max(500).nullable(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
export function notificationText(payload: NotificationPayload) {
  const resource = notificationResources[payload.language];
  return { title: resource[payload.kind], body: payload.reason ? `${resource.reason}: ${payload.reason}` : resource.open };
}
export function safeOrderTarget(value: string): string | null {
  const parsed = notificationPayloadSchema.shape.target.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export const pushEndpointSchema = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
    && (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
      || /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname));
});
export const pushSubscriptionSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  keys: z.strictObject({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export const pushConfigSchema = z.object({ publicKey: z.string().nullable() });
