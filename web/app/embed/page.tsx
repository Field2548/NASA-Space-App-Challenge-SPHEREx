import { Suspense } from "react";
import EmbedViewer from "@/components/EmbedViewer";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// Same pattern as /play: the search params are read inside Suspense so the shell stays static.
export default function EmbedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<EmbedViewer params={{}} loading />}>
      {searchParams.then((params) => (
        <EmbedViewer spot={typeof params.spot === "string" && params.spot ? params.spot : undefined} params={params} />
      ))}
    </Suspense>
  );
}
