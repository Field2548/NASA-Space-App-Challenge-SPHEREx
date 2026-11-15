import Tutorial from "@/components/Tutorial";

// /tutorial (BP 8.13). The page stays a server component; the tutorial is one client component
// that reads guest progress after mount, so no request data and no Suspense boundary are needed.
// PlayScreen supplies the page's single h1.
export default function TutorialPage() {
  return <Tutorial />;
}
