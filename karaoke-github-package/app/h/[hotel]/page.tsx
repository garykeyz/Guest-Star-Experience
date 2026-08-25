import KaraokeExperienceClient from "@/components/KaraokeExperienceClient";

export default async function HotelRequestPage({
  params
}: {
  params: Promise<{ hotel: string }>;
}) {
  const { hotel } = await params;
  return <KaraokeExperienceClient hotelCode={hotel} />;
}
