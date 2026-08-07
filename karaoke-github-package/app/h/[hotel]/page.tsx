import KaraokeExperience from "@/components/KaraokeExperience";

export default async function HotelRequestPage({
  params
}: {
  params: Promise<{ hotel: string }>;
}) {
  const { hotel } = await params;
  return <KaraokeExperience hotelCode={hotel} />;
}
