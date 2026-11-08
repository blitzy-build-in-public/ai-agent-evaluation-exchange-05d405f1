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
 * **The shell renders no landmark.** Every page owns the route's single `<main>` and its single
 * `<h1>` — the route root carries `.page`, `id="main-content"` and `tabIndex={-1}` — so the matched
 * element is wrapped in a plain container (`.app-main`) and never in a landmark. A `<main>` here
 * would nest one landmark inside another, and every page's own comment says the shell must not wrap
 * a page in another landmark.
 *
 * **The bypass link belongs to the shell.** It is the first focusable element on the page and its
 * target is the routed page's `#main-content`: that id and the page's `tabIndex={-1}` are a pair
 * with this link, which is what lets it move focus to the page without putting `<main>` in the tab
 * order.
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

import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { getSelectedDemoAccountId } from "./api-client";
import { DemoAccountSwitcher } from "./components/demo-account-switcher";
import { DemoBanner } from "./components/demo-banner";
import { Nav } from "./components/nav";
import Academy from "./pages/academy";
import Challenges from "./pages/challenges";
import ComparePage from "./pages/compare";
import DeveloperPage from "./pages/developer";
import Home from "./pages/home";
import ListingDetailPage from "./pages/listing-detail";
import ListingsPage from "./pages/listings";
import Mission from "./pages/mission";
import NotFound from "./pages/not-found";
import OpportunityIndex from "./pages/opportunity-index";
import ReportPage from "./pages/report";
import Standards from "./pages/standards";
import Threads from "./pages/threads";

/** What the bypass link says, and what it targets: the routed page's own landmark. */
const SKIP_LINK_LABEL = "Skip to main content";
const SKIP_LINK_TARGET = "#main-content";

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
        <a className="app-skip-link" href={SKIP_LINK_TARGET}>
          {SKIP_LINK_LABEL}
        </a>
        <header className="app-header">
          <Nav />
          <DemoAccountSwitcher value={selectedAccountId} onChange={handleAccountChange} />
          <DemoBanner />
        </header>
        <div className="app-main">
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
        </div>
      </div>
    </BrowserRouter>
  );
}
