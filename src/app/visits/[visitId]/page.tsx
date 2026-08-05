import { VisitDetailClient } from "./VisitDetailClient";

export default async function VisitDetailPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  return <VisitDetailClient visitId={visitId} />;
}
