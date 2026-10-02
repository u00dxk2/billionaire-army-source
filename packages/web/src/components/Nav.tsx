"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { User } from "@supabase/supabase-js";

// Canon Wave 3 (Rules 13/14): the nav needs a real "you are here" cue —
// previously no active state existed and the static featured pills read as one.
// R-053 nav cut, 7 items -> 5. The nav was a feature list; it is now a path.
// Compare and Leaderboard are still fully live routes and still linked — from where the
// intent actually forms, which is not the nav. Compare belongs on a profile (nobody arrives
// wanting to compare two strangers), and Leaderboard is a VIEW of the index rather than a
// separate place, so keeping both up here asked a first-time visitor to guess the difference
// between "Profiles" and "Leaderboard" before they had seen either.
// Do NOT re-add them without re-reading that reasoning — the cut is the point.
const NAV_LINKS = [
  { href: "/feed", label: "Feed", featured: true },
  { href: "/today", label: "Today's 10", featured: true },
  { href: "/goals", label: "The Assignment" },
  { href: "/billionaires", label: "Profiles" },
  { href: "/about", label: "About" },
];

export default function Nav() {
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const supabase = createClient();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="header">
      <nav className="nav">
        <a href="/" className="logo">
          Billionaire Army
        </a>
        <button
          type="button"
          className="nav-toggle"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="nav-links"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
        <div
          id="nav-links"
          className={`nav-links${menuOpen ? " nav-links--open" : ""}`}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={[
                link.featured ? "nav-link-featured" : "",
                isActive(link.href) ? "nav-link--active" : "",
              ].join(" ").trim() || undefined}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
          {user ? (
            <button onClick={handleSignOut} className="nav-auth-btn">
              Sign Out
            </button>
          ) : (
            <a href="/login" className="nav-auth-btn">
              Sign In
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}
