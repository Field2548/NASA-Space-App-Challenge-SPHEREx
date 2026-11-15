import { Suspense } from "react";
import PlayRoute from "@/components/PlayRoute";
import PlayScreen from "@/components/PlayScreen";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// cacheComponents is on: the page stays synchronous and the search params are read inside a Suspense
// boundary, so the fallback is part of the static shell (docs: caching, "Maximizing the static shell").
export default function PlayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<PlayScreen loading />}>
      {searchParams.then((params) => (
        <PlayRoute spot={typeof params.spot === "string" && params.spot ? params.spot : undefined} params={params} />
      ))}
    </Suspense>
  );
}
