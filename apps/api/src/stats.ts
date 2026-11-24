import { createHash, timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { AppError, type AppEnv } from './app';
import type { AppConfig } from './config';
import type { openDatabase } from './database';

const dayMs = 86400000;
const digest = (value: string) => createHash('sha256').update(value).digest();

export function registerStats(
  app: Hono<AppEnv>,
  sqlite: ReturnType<typeof openDatabase>['sqlite'],
  config: AppConfig,
) {
  if (!config.STATS_TOKEN) return;
  const expected = digest(config.STATS_TOKEN);
  const localTime = new Intl.DateTimeFormat('en', {
    timeZone: config.OFFICE_TIMEZONE ?? 'Asia/Dhaka',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  function officeTime(timestamp: number) {
    const parts = new Map(
      localTime.formatToParts(timestamp).map(({ type, value }) => [type, value]),
    );
    return {
      day: new Date(
        Date.UTC(
          Number(parts.get('year')),
          Number(parts.get('month')) - 1,
          Number(parts.get('day')),
        ),
      ),
      hour: Number(parts.get('hour')),
    };
  }
  const deliveries = sqlite.prepare<
    { id: string; completedAt: number; name: string; quantity: number },
    [number, number]
  >(`
    SELECT orders.id, completed_at AS completedAt, order_item.name, order_item.quantity
    FROM orders JOIN order_item ON order_item.order_id = orders.id
    WHERE orders.status = 'DELIVERED' AND completed_at >= ? AND completed_at <= ?
  `);

  app.get('/api/stats', (c) => {
    const token = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
    if (!token || !timingSafeEqual(digest(token), expected)) {
      c.header('WWW-Authenticate', 'Bearer');
      throw new AppError('UNAUTHORIZED', 401);
    }
    const generatedAt = Date.now();
    const { day: today } = officeTime(generatedAt);
    const monday = today.getTime() - ((today.getUTCDay() + 6) % 7) * dayMs;
    const counted = new Set<string>();
    const items = new Map<string, number>();
    const hours = new Map<number, number>();
    let todayOrders = 0;
    let todayItems = 0;
    let weekItems = 0;
    // The extra UTC day covers all timezone offsets; local dates define the actual window.
    for (const row of deliveries.iterate(monday - dayMs, generatedAt)) {
      const { day, hour } = officeTime(row.completedAt);
      if (day.getTime() < monday) continue;
      const deliveredToday = day.getTime() === today.getTime();
      if (!counted.has(row.id)) {
        counted.add(row.id);
        hours.set(hour, (hours.get(hour) ?? 0) + 1);
        if (deliveredToday) todayOrders++;
      }
      if (deliveredToday) todayItems += row.quantity;
      weekItems += row.quantity;
      items.set(row.name, (items.get(row.name) ?? 0) + row.quantity);
    }
    const topItems = [...items]
      .sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : a === b ? 0 : 1))
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity }));
    const busiestHour =
      [...hours].sort(([a, countA], [b, countB]) => countB - countA || a - b)[0]?.[0] ?? null;
    return c.json({
      generatedAt,
      today: { orders: todayOrders, items: todayItems },
      week: { items: weekItems, topItems, busiestHour },
    });
  });
}
