import type { Metadata } from "next";
import StagesScreen from "@/components/StagesScreen";

export const metadata: Metadata = { title: "Stages" };

export default function Page() {
  return <StagesScreen />;
}
