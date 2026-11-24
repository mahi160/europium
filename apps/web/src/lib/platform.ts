export const platforms = ['ios', 'android', 'windows', 'mac', 'other'] as const;
export type Platform = (typeof platforms)[number];

export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  // iPadOS Safari reports a desktop Mac user agent; touch support tells them apart.
  if (/Macintosh/.test(userAgent)) return maxTouchPoints > 1 ? 'ios' : 'mac';
  if (/Windows/.test(userAgent)) return 'windows';
  return 'other';
}
