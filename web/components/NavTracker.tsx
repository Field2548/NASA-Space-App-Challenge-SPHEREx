"use client";
// Feeds lib/navStack with every pathname change (client-side navigation), for BackLink. Renders nothing.

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPath } from "@/lib/navStack";

export default function NavTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) trackPath(pathname);
  }, [pathname]);
  return null;
}
