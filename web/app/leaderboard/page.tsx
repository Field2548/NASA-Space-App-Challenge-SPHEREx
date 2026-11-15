import type { Metadata } from "next";
import LeaderboardScreen from "@/components/LeaderboardScreen";

export const metadata: Metadata = { title: "Leaderboard" };

export default function Page() {
  return <LeaderboardScreen />;
}
