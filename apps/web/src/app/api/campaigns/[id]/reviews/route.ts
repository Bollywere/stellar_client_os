export const runtime = "nodejs";

import {
  getReviewEligibility,
  getRatingSummary,
  listReviews,
  submitCampaignReview,
  type CampaignReview,
  type RatingSummary,
  type ReviewEligibility,
} from "@/services/campaign-reviews.service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const viewer = url.searchParams.get("viewer");
  const summary: RatingSummary = getRatingSummary(id);
  const reviews: CampaignReview[] = listReviews(id);
  let eligibility: ReviewEligibility | null = null;
  if (viewer) {
    eligibility = await getReviewEligibility(id, viewer);
  }
  return Response.json({ reviews, summary, eligibility }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { backerAddress?: string; rating?: number; reviewText?: string };
    if (!body.backerAddress || !body.rating) {
      return Response.json({ error: "backerAddress and rating are required" }, { status: 400 });
    }
    const result = await submitCampaignReview({
      campaignId: id,
      backerAddress: body.backerAddress,
      rating: body.rating,
      reviewText: body.reviewText,
    });
    if (!result.ok) {
      const status = result.reason === "campaign_not_found" ? 404 : result.reason === "eligible" ? 400 : 403;
      return Response.json({ error: result.error, reason: result.reason }, { status });
    }
    return Response.json({ review: result.review, summary: result.summary }, { status: 201 });
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }
}
