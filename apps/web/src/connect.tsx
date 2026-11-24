import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { encode } from 'uqr';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/600.css';
import { applyLanguage, number } from './i18n';
import './index.css';
import { Button, buttonVariants } from './components/ui/button';
import { Card, CardContent, CardHeader } from './components/ui/card';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { detectPlatform, platforms, type Platform } from './lib/platform';

// Served over plain HTTP by Caddy: this page exists to install the certificate that makes HTTPS trusted.
const certificate = '/office-root.crt';
const steps: Record<Platform, number> = { ios: 4, android: 4, windows: 4, mac: 3, other: 1 };

function Qr({ value }: { value: string }) {
  const { size, data } = encode(value, { ecc: 'M', border: 2 });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-64" role="img" aria-label={value}>
      <rect width={size} height={size} fill="#fff" />
      <path
        shapeRendering="crispEdges"
        d={data
          .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
          .join('')}
      />
    </svg>
  );
}

function Connect() {
  const { t, i18n } = useTranslation();
  const [platform, setPlatform] = useState<Platform>(() =>
    detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
  );
  const host = location.host;
  const connectUrl = `http://${host}/connect`;
  const appUrl = `https://${host}/`;
  return (
    <main className="mx-auto grid max-w-xl gap-4 p-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <strong>{t('app')}</strong>
        <Button
          variant="outline"
          size="sm"
          onClick={() => applyLanguage(i18n.language === 'en' ? 'bn' : 'en')}
        >
          {i18n.language === 'en' ? 'বাংলা' : 'English'}
        </Button>
      </div>
      <Card className="print:hidden">
        <CardHeader>
          <h1>{t('connect.title')}</h1>
          <p className="text-muted-foreground">{t('connect.intro')}</p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Tabs value={platform} onValueChange={(value: Platform) => setPlatform(value)}>
            <TabsList className="w-full">
              {platforms.map((item) => (
                <TabsTrigger key={item} value={item}>
                  {t('connect.platform.' + item)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <ol className="grid gap-4">
            {Array.from({ length: steps[platform] }, (_, index) => (
              <li key={platform + index} className="flex gap-3">
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {number(index + 1)}
                </span>
                <div className="grid gap-2">
                  <span>{t(`connect.${platform}${index + 1}`)}</span>
                  {index === 0 && platform !== 'other' && (
                    <a
                      href={certificate}
                      // Android saves CA certificates to Downloads; other platforms open their installer.
                      download={platform === 'android' ? 'office-root.crt' : undefined}
                      className={buttonVariants({ size: 'lg', className: 'w-fit' })}
                    >
                      {t('connect.download')}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="grid gap-2 border-t pt-4">
            <p>{t('connect.test')}</p>
            <a href={appUrl} className={buttonVariants({ variant: 'outline', className: 'w-fit' })}>
              {t('connect.open')}
            </a>
          </div>
        </CardContent>
      </Card>
      <Card className="print:hidden">
        <CardContent className="grid gap-2">
          <p className="text-muted-foreground">{t('connect.posterHelp')}</p>
          <Button variant="outline" className="w-fit" onClick={() => window.print()}>
            {t('connect.print')}
          </Button>
        </CardContent>
      </Card>
      <section className="hidden place-items-center gap-6 pt-16 text-center print:grid">
        <h1 className="text-3xl">{t('app')}</h1>
        <p className="text-xl">{t('connect.posterTitle')}</p>
        <Qr value={connectUrl} />
        <p className="font-mono text-lg">{connectUrl}</p>
        <p className="max-w-md">{t('connect.posterSteps')}</p>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <Connect />
  </StrictMode>,
);
