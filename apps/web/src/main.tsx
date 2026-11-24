import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import './i18n';
import './index.css';
import { Application } from './pages/application';

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: true }, mutations: { retry: false } } });
const rootRoute = createRootRoute();
const paths = ['/', '/admin'] as const;
const routes = paths.map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: Application }));
const router = createRouter({ routeTree: rootRoute.addChildren(routes) });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></StrictMode>);
