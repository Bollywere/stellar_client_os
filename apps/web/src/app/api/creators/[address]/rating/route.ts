export const runtime = "nodejs";

import { getCreatorOverallRating } from "@/services/campaign-reviews.service";

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const rating = await getCreatorOverallRating(address);
  return Response.json(rating, { headers: { "Cache-Control": "private, no-store" } });
}
