"use client";
import { useEffect } from "react";

/** Opens the <details> endpoint card that matches the URL hash. */
export default function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el instanceof HTMLDetailsElement) { el.open = true; el.scrollIntoView(); }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
