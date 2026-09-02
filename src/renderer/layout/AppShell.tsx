import { useState } from 'react';

import { appRoutes, EmptyRoute, type AppRoute } from '../routes';

export function AppShell() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(appRoutes[0]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>

      <header className="app-shell__header">
        <span className="app-shell__brand">AutoVision Studio</span>
      </header>

      <div className="app-shell__body">
        <nav
          aria-label="主要画面"
          className="app-shell__navigation"
        >
          <ul className="app-shell__navigation-list">
            {appRoutes.map((route) => {
              const isActive = route.screenId === activeRoute.screenId;

              return (
                <li key={route.screenId}>
                  <a
                    aria-current={isActive ? 'page' : undefined}
                    className="app-shell__navigation-link"
                    href={route.path}
                    onClick={(event) => {
                      event.preventDefault();
                      setActiveRoute(route);
                    }}
                  >
                    {route.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="app-shell__main" id="main-content" tabIndex={-1}>
          <EmptyRoute route={activeRoute} />
        </main>
      </div>
    </div>
  );
}