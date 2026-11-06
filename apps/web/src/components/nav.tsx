import { useState } from "react";
import { NavLink } from "react-router-dom";

interface NavDestination {
  readonly to: string;
  readonly label: string;
  readonly exact: boolean;
}

const NAV_MENU_ID = "adem-nav-menu";

const NAV_DESTINATIONS: readonly NavDestination[] = [
  { to: "/", label: "Home", exact: true },
  { to: "/mission", label: "Mission", exact: false },
  { to: "/listings", label: "Listings", exact: false },
  { to: "/compare", label: "Compare", exact: false },
  { to: "/developer", label: "Developer", exact: false },
  { to: "/challenges", label: "Challenges", exact: false },
  { to: "/threads", label: "Threads", exact: false },
  { to: "/standards", label: "Standards", exact: false },
  { to: "/academy", label: "Academy", exact: false },
  { to: "/opportunity-index", label: "Opportunity index", exact: false },
];

/**
 * The primary navigation: the ten top-level destinations plus a disclosure
 * control for narrow widths. Listing, report and absent routes are reached from
 * within pages, so no id-bearing link belongs here. The list stays mounted
 * and collapses by the `is-open` class rather than unmounting, so `aria-controls`
 * always resolves; the current page is marked by NavLink's own
 * `aria-current="page"`, not by colour alone, and the root link carries `end` or
 * it would be current on every route.
 */
export function Nav(): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);

  function handleToggle(): void {
    setIsMenuOpen((open: boolean): boolean => !open);
  }

  return (
    <nav className={isMenuOpen ? "nav is-open" : "nav"} aria-label="Main">
      <button
        type="button"
        className="nav__toggle"
        aria-expanded={isMenuOpen}
        aria-controls={NAV_MENU_ID}
        onClick={handleToggle}
      >
        Menu
      </button>
      <ul id={NAV_MENU_ID} className={isMenuOpen ? "nav__menu is-open" : "nav__menu"}>
        {NAV_DESTINATIONS.map((destination: NavDestination) => (
          <li key={destination.to} className="nav__item">
            <NavLink className="nav__link" to={destination.to} end={destination.exact}>
              {destination.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
