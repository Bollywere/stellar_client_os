import { backersService } from "./campaign-backers.service";
import { getCampaign, queryCampaigns, type CampaignRecord } from "./campaign.service";

/**
 * Campaign testimonial & star review system (issue #1250).
 *
 * Backers who received their rewards can leave one star rating plus an
 * optional short testimonial per campaign. Reviews open 30 days after a
 * campaign closes (AC1) so sponsors have received their rewards first.
 * Ratings aggregate per campaign and per creator for the portfolio page (AC3).
 *
 * Storage is in-memory, matching the repo's service conventions.
 */

export interface CampaignReview {
  id: string;
  campaignId: string;
  backerAddress: string;
  /** Whole stars, 1–5. */
  rating: number;
  /** Optional short testimonial text. */
  reviewText?: string;
  createdAt: number;
}

export interface RatingSummary {
  /** Rounded to one decimal; null when there are no reviews. */
  averageRating: number | null;
  reviewCount: number;
}

export interface CreatorOverallRating extends RatingSummary {
  creatorAddress: string;
  campaignCount: number;
}

export type ReviewEligibilityReason =
  | "eligible"
  | "campaign_not_found"
  | "campaign_not_closed"
  | "review_window_pending"
  | "not_a_backer"
  | "already_reviewed";

export interface ReviewEligibility {
  eligible: boolean;
  reason: ReviewEligibilityReason;
  /** Epoch ms when reviews open; only set for `review_window_pending`. */
  opensAt?: number;
}

export type ReviewActionResult =
  | { ok: true; review: CampaignReview; summary: RatingSummary }
  | { ok: false; error: string; reason?: ReviewEligibilityReason };

export const REVIEW_OPENING_DELAY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REVIEW_TEXT_LENGTH = 1_000;

const reviews = new Map<string, CampaignReview[]>();

function key(campaignId: string): string {
  return campaignId.trim();
}

function isClosed(status: CampaignRecord["status"]): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

/**
 * Reviews become available once 30 days have passed since the campaign
 * closed (AC1). Callers decide which closed state counts for their flow.
 */
export function reviewOpensAt(campaign: Pick<CampaignRecord, "statusChangedAt">): number {
  return campaign.statusChangedAt + REVIEW_OPENING_DELAY_DAYS * DAY_MS;
}

export function checkReviewEligibility(
  campaignId: string,
  backerAddress: string,
  now: number = Date.now(),
  campaignLookup: (id: string) => CampaignRecord | null = () => null,
): ReviewEligibility {
  const campaign = campaignLookup(campaignId);
  if (!campaign) return { eligible: false, reason: "campaign_not_found" };
  if (!isClosed(campaign.status)) return { eligible: false, reason: "campaign_not_closed" };

  const opensAt = reviewOpensAt(campaign);
  if (now < opensAt) return { eligible: false, reason: "review_window_pending", opensAt };

  const isBacker = backersService.getContributions(key(campaignId)).some(
    (entry) => entry.backerAddress.trim().toLowerCase() === backerAddress.trim().toLowerCase(),
  );
  if (!isBacker) return { eligible: false, reason: "not_a_backer" };

  if (listReviews(campaignId).some((review) => review.backerAddress.trim().toLowerCase() === backerAddress.trim().toLowerCase())) {
    return { eligible: false, reason: "already_reviewed" };
  }

  return { eligible: true, reason: "eligible" };
}

export async function getReviewEligibility(
  campaignId: string,
  backerAddress: string,
  now: number = Date.now(),
): Promise<ReviewEligibility> {
  return checkReviewEligibility(campaignId, backerAddress, now, await asyncCampaignLookup(campaignId));
}

async function asyncCampaignLookup(campaignId: string): Promise<(id: string) => CampaignRecord | null> {
  const campaign = await getCampaign(key(campaignId));
  return () => campaign;
}

export function listReviews(campaignId: string): CampaignReview[] {
  return [...(reviews.get(key(campaignId)) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

export function getRatingSummary(campaignId: string): RatingSummary {
  const entries = reviews.get(key(campaignId)) ?? [];
  if (entries.length === 0) return { averageRating: null, reviewCount: 0 };
  const total = entries.reduce((sum, review) => sum + review.rating, 0);
  return { averageRating: Math.round((total / entries.length) * 10) / 10, reviewCount: entries.length };
}

export async function getCreatorOverallRating(creatorAddress: string): Promise<CreatorOverallRating> {
  const campaigns = await queryCampaigns({ filter: { creator: creatorAddress }, limit: 100 });
  let total = 0;
  let count = 0;
  for (const campaign of campaigns) {
    for (const review of reviews.get(key(campaign.id)) ?? []) {
      total += review.rating;
      count += 1;
    }
  }
  return {
    creatorAddress,
    averageRating: count > 0 ? Math.round((total / count) * 10) / 10 : null,
    reviewCount: count,
    campaignCount: campaigns.length,
  };
}

export function getCampaignRatingSummaries(campaignIds: string[]): Record<string, RatingSummary> {
  return Object.fromEntries(campaignIds.map((id) => [id, getRatingSummary(id)]));
}

export async function submitCampaignReview(
  input: { campaignId: string; backerAddress: string; rating: number; reviewText?: string },
  now: number = Date.now(),
): Promise<ReviewActionResult> {
  const campaignId = key(input.campaignId);
  const backerAddress = input.backerAddress?.trim();
  if (!campaignId || !backerAddress) {
    return { ok: false, error: "campaignId and backerAddress are required" };
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "rating must be a whole number between 1 and 5" };
  }
  const reviewText = input.reviewText?.trim();
  if (reviewText && reviewText.length > MAX_REVIEW_TEXT_LENGTH) {
    return { ok: false, error: `reviewText must be at most ${MAX_REVIEW_TEXT_LENGTH} characters` };
  }

  const eligibility = await getReviewEligibility(campaignId, backerAddress, now);
  if (!eligibility.eligible) {
    return { ok: false, error: REVIEW_ERRORS[eligibility.reason], reason: eligibility.reason };
  }

  const review: CampaignReview = {
    id: `${campaignId}:review:${backerAddress}:${now}`,
    campaignId,
    backerAddress,
    rating: input.rating,
    reviewText: reviewText || undefined,
    createdAt: now,
  };
  reviews.set(campaignId, [...(reviews.get(campaignId) ?? []), review]);
  return { ok: true, review, summary: getRatingSummary(campaignId) };
}

const REVIEW_ERRORS: Record<ReviewEligibilityReason, string> = {
  eligible: "",
  campaign_not_found: "Campaign not found",
  campaign_not_closed: "Reviews open once the campaign closes",
  review_window_pending: `Reviews open ${REVIEW_OPENING_DELAY_DAYS} days after the campaign closes`,
  not_a_backer: "Only backers who received rewards can leave a review",
  already_reviewed: "You have already reviewed this campaign",
};

/** Test helper: wipe all stored reviews. */
export function resetCampaignReviews(): void {
  reviews.clear();
}
