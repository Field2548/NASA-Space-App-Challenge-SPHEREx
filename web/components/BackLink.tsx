"use client";
// Back control for the footer pages and /settings /stages. With a previous page on this site it goes
// back in history; otherwise (direct visit, other site) it is a plain link to "/".

import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./BackLink.module.css";

export default function BackLink() {
  const router = useRouter();
  return (
    <Link
      href="/"
      className={styles.back}
      onClick={(e) => {
        const sameSite = document.referrer.startsWith(window.location.origin) && window.history.length > 1;
        if (!sameSite) return;
        e.preventDefault();
        router.back();
      }}
    >
      ← Back
    </Link>
  );
}
