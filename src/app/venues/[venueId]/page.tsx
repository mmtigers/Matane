import { VenueDetailClient } from "./VenueDetailClient";

export default async function VenueDetailPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;
  return <VenueDetailClient venueId={venueId} />;
}
