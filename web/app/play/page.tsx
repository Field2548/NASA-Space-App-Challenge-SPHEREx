import { Suspense } from "react";
import PlayScreen from "@/components/PlayScreen";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// cacheComponents is on: the page stays synchronous and ?spot= is read inside a Suspense
// boundary, so the fallback is part of the static shell (docs: caching, "Maximizing the static shell").
export default function PlayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PlayScreen loading />}>
      {searchParams.then(({ spot }) => (
        <PlayScreen spot={typeof spot === "string" && spot ? spot : undefined} />
      ))}
    </Suspense>
  );
}
