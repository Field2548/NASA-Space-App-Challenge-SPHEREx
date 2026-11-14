import type { Metadata } from "next";
import MapScreen from "@/components/MapScreen";

export const metadata: Metadata = { title: "Sky map" };

// /map: the sky map, reached from the title screen's "Explore the sky". MapScreen holds the h1.
export default function MapPage() {
  return <MapScreen />;
}
