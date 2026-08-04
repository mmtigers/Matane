import { RegisterVisitClient } from "./RegisterVisitClient";

export default async function RegisterVisitPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  return <RegisterVisitClient visitId={visitId} />;
}
