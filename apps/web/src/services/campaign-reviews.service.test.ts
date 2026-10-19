import { beforeEach, describe, expect, it } from "vitest";
import {
  REVIEW_OPENING_DELAY_DAYS,
  checkReviewEligibility,
  getCampaignRatingSummaries,
  getRatingSummary,
  listReviews,
  resetCampaignReviews,
  submitCampaignReview,
} from "./campaign-reviews.service";
import { backersService } from "./campaign-backers.service";
import type { CampaignRecord } from "./campaign.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const CAMPAIGN = "camp-rev-1";
const BACKER = "GBACKER...AAAA";
const OTHER = "GOTHER...BBBB";
const NOW = 1_700_000_000_000;

function closedCampaign(status: CampaignRecord["status"] = "COMPLETED", closedAt = NOW - 40 * DAY_MS): CampaignRecord {
  return {
    id: CAMPAIGN,
    creator: "GCREATOR...AAAA",
    name: "Reviewable campaign",
    status,
    goalAmount: "50000",
    raisedAmount: "40000",
    sponsorCount: 1,
    treeCount: 10,
    createdAt: closedAt - 100 * DAY_MS,
    updatedAt: closedAt,
    statusChangedAt: closedAt,
    sponsors: [],
    statusHistory: [],
  };
}

const campaignLookup = () => closedCampaign();

beforeEach(() => {
  resetCampaignReviews();
  backersService.reset();
  backersService.registerCampaignCreator(CAMPAIGN, "GCREATOR...AAAA");
  backersService.recordContribution({ campaignId: CAMPAIGN, backerAddress: BACKER, amount: "900", token: "XLM", displayName: "Alice" });
});

describe("review eligibility (AC1)", () => {
  it("opens reviews only 30 days after the campaign closes", () => {
    const justClosed = closedCampaign("COMPLETED", NOW - REVIEW_OPENING_DELAY_DAYS * DAY_MS + 1000);
    expect(checkReviewEligibility(CAMPAIGN, BACKER, NOW, () => justClosed)).toMatchObject({
      eligible: false,
      reason: "review_window_pending",
    });

    const oldEnough = closedCampaign("COMPLETED", NOW - REVIEW_OPENING_DELAY_DAYS * DAY_MS - 1000);
    expect(checkReviewEligibility(CAMPAIGN, BACKER, NOW, () => oldEnough).eligible).toBe(true);
  });

  it("rejects open campaigns, non-backers, and repeat reviews", () => {
    expect(checkReviewEligibility(CAMPAIGN, BACKER, NOW, () => closedCampaign("ACTIVE", NOW - 90 * DAY_MS)).reason).toBe(
      "campaign_not_closed",
    );
    expect(checkReviewEligibility(CAMPAIGN, OTHER, NOW, campaignLookup).reason).toBe("not_a_backer");
    expect(checkReviewEligibility("ghost", BACKER, NOW, () => null).reason).toBe("campaign_not_found");
  });
});

describe("submitCampaignReview (AC2: stars + optional text)", () => {
  it("stores a star rating with optional text and aggregates the average", async () => {
    const withText = await submitCampaignReview({ campaignId: CAMPAIGN, backerAddress: BACKER, rating: 4, reviewText: "Great work!" }, NOW);
    expect(withText.ok).toBe(true);

    backersService.recordContribution({ campaignId: CAMPAIGN, backerAddress: OTHER, amount: "100", token: "XLM", displayName: "Bob" });
    const starsOnly = await submitCampaignReview({ campaignId: CAMPAIGN, backerAddress: OTHER, rating: 5 }, NOW + 1);
    expect(starsOnly.ok).toBe(true);

    const summary = getRatingSummary(CAMPAIGN);
    expect(summary).toEqual({ averageRating: 4.5, reviewCount: 2 });
    expect(listReviews(CAMPAIGN)).toHaveLength(2);
    expect(getCampaignRatingSummaries([CAMPAIGN])[CAMPAIGN]).toEqual(summary);
  });

  it("rejects out-of-range ratings, oversized text, and ineligible submissions", async () => {
    const badRating = await submitCampaignReview({ campaignId: CAMPAIGN, backerAddress: BACKER, rating: 6 }, NOW);
    expect(badRating.ok).toBe(false);

    const tooLong = await submitCampaignReview(
      { campaignId: CAMPAIGN, backerAddress: BACKER, rating: 5, reviewText: "x".repeat(1001) },
      NOW,
    );
    expect(tooLong.ok).toBe(false);

    const tooEarly = await submitCampaignReview({ campaignId: CAMPAIGN, backerAddress: BACKER, rating: 5 }, NOW - 100 * DAY_MS);
    expect(tooEarly).toMatchObject({ ok: false, reason: "review_window_pending" });
    expect(listReviews(CAMPAIGN)).toHaveLength(0);
  });
});
