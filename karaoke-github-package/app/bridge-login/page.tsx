import HostPanel from "@/components/HostPanel";

export default async function BridgeLoginPage({
  searchParams
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = "" } = await searchParams;
  return <HostPanel oneTimeCode={code} />;
}
