import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ApiClientError } from './api/client';
import { AppShell, RequireAuth, RequireModerator } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocaleProvider } from './i18n/LocaleContext';
import { AdminPage } from './pages/admin/AdminPage';
import { AuthPage } from './pages/Auth';
import { CreateEventPage } from './pages/CreateEvent';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/Events';
import { HomePage } from './pages/Home';
import { LandingPage } from './pages/Landing';
import { MatchRoomPage } from './pages/MatchRoom';
import { NotFoundPage } from './pages/NotFound';
import { ProfilePage } from './pages/Profile';
import { RequestFlowPage } from './pages/RequestFlow';
import { SettingsPage } from './pages/Settings';
import { GuidelinesPage, PrivacyPage, SupportPage, TermsPage } from './pages/StaticPages';
import { ToastProvider } from './ui/Toast';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Weak-network defaults: retry transient failures with backoff, never retry 4xx.
        retry: (failureCount, error) => {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        staleTime: 10_000,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ErrorBoundary>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/guidelines" element={<GuidelinesPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/support" element={<SupportPage />} />
                  <Route path="/auth" element={<AuthPage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route
                    path="/events/new"
                    element={
                      <RequireAuth>
                        <CreateEventPage />
                      </RequireAuth>
                    }
                  />
                  <Route path="/events/:idOrCode" element={<EventPage />} />
                  <Route
                    path="/events/:id/request"
                    element={
                      <RequireAuth>
                        <RequestFlowPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/home"
                    element={
                      <RequireAuth>
                        <HomePage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/matches/:id"
                    element={
                      <RequireAuth>
                        <MatchRoomPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <RequireAuth>
                        <SettingsPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <RequireAuth>
                        <ProfilePage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <RequireModerator>
                        <AdminPage />
                      </RequireModerator>
                    }
                  />
                  <Route
                    path="/admin/:section"
                    element={
                      <RequireModerator>
                        <AdminPage />
                      </RequireModerator>
                    }
                  />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </ErrorBoundary>
  );
}
