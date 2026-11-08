/**
 * The application shell: the router, the frame every page renders inside, and the demonstration
 * identity that stays visible on every route.
 *
 * **The route table is a contract.** Thirteen routes, one per page module, and the two paths that
 * carry an identifier — `/listings/:id` and `/reports/:id` — spell that segment `id`, which is the
 * key the listing page and the report page read back through `useParams`. The page file names, this
 * table and the root `e2e/route-walk.spec.ts` are one contract: rename a path here and three places
 * disagree rather than one.
 *
 * **The shell adds no landmark around the routed page.** Every page owns the route's single
 * `<main>` and its single `<h1>` — the route root carries `.page`, `id="main-content"` and
 * `tabIndex={-1}` — so the matched element is wrapped in a plain container (`.app-main`) and never
 * in a landmark. A `<main>` here would nest one landmark inside another, and every page's own
 * comment says the shell must not wrap a page in another landmark.
 *
 * **Each route's page module is loaded on demand.** No page module is imported eagerly: each is
 * fetched when its route is matched, so a visitor downloads the page they asked for rather than all
 * thirteen, and the routes sit inside one `<Suspense>` boundary. That boundary's fallback is a
 * status region and nothing more — it adds no landmark and no heading, because the routed page owns
 * the document's single `<main>` and its single `<h1>`, and the shell wraps no page in a landmark
 * and stands no heading in front of one.
 *
 * **The bypass link belongs to the shell.** It renders inside the header's banner landmark, as the
 * header's first child, so it precedes the navigation in source order and — the header being the
 * shell's first child — it stays the document's first focusable element. Its target is the routed
 * page's `#main-content`: that id and the page's `tabIndex={-1}` are a pair with this link, which is
 * what lets it move focus to the page without putting `<main>` in the tab order. Moving it under the
 * header needs no CSS: the link is absolutely positioned against the initial containing block,
 * because neither `.app-header` nor `.app-shell` is positioned, so its resting position off the top
 * of the viewport and its reveal on focus are unchanged.
 *
 * **The demonstration disclosure is persistent and sits in the header.** The banner renders on every
 * route and at every width — the stylesheet gives it its own line inside the header row at desktop
 * widths — and it is deliberately not dismissible, because a disclosure a reader can close stops
 * being a disclosure. The switcher names the same label beside its control, from the one definition
 * of that sentence.
 *
 * **The shell is wiring only.** It holds the selected demo account — the single piece of client state
 * in this workspace, hydrated from `../api-client`'s documented `sessionStorage` key through
 * `getSelectedDemoAccountId`, which reads as `null` rather than throwing when storage is unavailable
 * or refused. It makes no request, derives no label and holds no business rule: loading, empty,
 * error, absent and throttled states belong to the page that owns them, and a page with no data of
 * its own still renders its own explanation.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { getSelectedDemoAccountId } from "./api-client";
import { DemoAccountSwitcher } from "./components/demo-account-switcher";
import { DemoBanner } from "./components/demo-banner";
import { Nav } from "./components/nav";

const Academy = lazy(() => import("./pages/academy"));
const Challenges = lazy(() => import("./pages/challenges"));
const ComparePage = lazy(() => import("./pages/compare"));
const DeveloperPage = lazy(() => import("./pages/developer"));
const Home = lazy(() => import("./pages/home"));
const ListingDetailPage = lazy(() => import("./pages/listing-detail"));
const ListingsPage = lazy(() => import("./pages/listings"));
const Mission = lazy(() => import("./pages/mission"));
const NotFound = lazy(() => import("./pages/not-found"));
const OpportunityIndex = lazy(() => import("./pages/opportunity-index"));
const ReportPage = lazy(() => import("./pages/report"));
const Standards = lazy(() => import("./pages/standards"));
const Threads = lazy(() => import("./pages/threads"));

/** What the bypass link says, and what it targets: the routed page's own landmark. */
const SKIP_LINK_LABEL = "Skip to main content";
const SKIP_LINK_TARGET = "#main-content";

/**
 * What the shell announces, politely, while a route's page module is being fetched. It is a status
 * sentence only: the fallback it belongs to carries no landmark and no heading, because the page it
 * is about to be replaced by owns both.
 */
const ROUTE_LOADING_SENTENCE =
  "Loading this page. Its module is fetched on demand, so the page appears as soon as its own code has arrived; the shell reads no data of its own.";

/**
 * The shell: the router, the header and the frame the matched page renders in.
 *
 * @returns The application, with its router, header, bypass link and the single element the
 * current address matches.
 */
export default function App(): JSX.Element {
  // The selected synthetic account, mirrored into React state so the switcher can render the
  // selection. The value itself is owned by `../api-client`, which is also what persists it; this
  // copy exists only so the control shows what the next write will be sent as.
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Read once on mount rather than during render: the stored value is client state, and reading it
  // in the effect keeps the first render free of any storage access.
  useEffect((): void => {
    setSelectedAccountId(getSelectedDemoAccountId());
  }, []);

  // Reported by the switcher, which has already applied the same selection to the client itself —
  // it writes before it reports, so the account the next write is sent as is current even if this
  // handler lags a render behind.
  function handleAccountChange(id: string): void {
    setSelectedAccountId(id);
  }

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="app-header">
          <a className="app-skip-link" href={SKIP_LINK_TARGET}>
            {SKIP_LINK_LABEL}
          </a>
          <Nav />
          <DemoAccountSwitcher value={selectedAccountId} onChange={handleAccountChange} />
          <DemoBanner />
        </header>
        <div className="app-main">
          <Suspense
            fallback={
              <p className="status-region" role="status" aria-live="polite">
                {ROUTE_LOADING_SENTENCE}
              </p>
            }
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/mission" element={<Mission />} />
              <Route path="/listings" element={<ListingsPage />} />
              <Route path="/listings/:id" element={<ListingDetailPage />} />
              <Route path="/compare" element={<ComparePage />} />
              <Route path="/developer" element={<DeveloperPage />} />
              <Route path="/challenges" element={<Challenges />} />
              <Route path="/threads" element={<Threads />} />
              <Route path="/standards" element={<Standards />} />
              <Route path="/reports/:id" element={<ReportPage />} />
              <Route path="/academy" element={<Academy />} />
              <Route path="/opportunity-index" element={<OpportunityIndex />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  );
}
