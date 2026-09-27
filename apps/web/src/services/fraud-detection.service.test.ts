import { describe, expect, it } from "vitest";
import { FraudDetectionService } from "./fraud-detection.service";

describe("FraudDetectionService v1 campaign anomalies", () => {
  it("flags unrealistic tree counts", async () => {
    const report = await new FraudDetectionService().analyzeCampaign({ campaignId: "trees", treeCount: 500_000, targetTrees: 1_000, campaignDurationDays: 30 });
    expect(report.flags.map((flag) => flag.patternType)).toContain("UNREALISTIC_TREE_COUNT");
  });
  it("flags suspicious verification records", async () => {
    const report = await new FraudDetectionService().analyzeCampaign({
      campaignId: "verification", treeCount: 100,
      verifications: [
        { verifierId: "same", status: "verified", treeCount: 75 },
        { verifierId: "same", status: "verified", treeCount: 75 },
      ],
    });
    expect(report.flags.map((flag) => flag.patternType)).toContain("SUSPICIOUS_VERIFICATION");
  });
  it("flags bot-like sponsors", async () => {
    const report = await new FraudDetectionService().analyzeCampaign({
      campaignId: "bots",
      backers: [1, 2, 3].map((id) => ({ backerAddress: `G${id}`, pledgeAmount: 1, pledgedAt: new Date().toISOString(), accountAgeDays: 0, verificationStatus: "failed" })),
    });
    expect(report.flags.map((flag) => flag.patternType)).toContain("BOT_SPONSORS");
  });
  it("flags a meaningful location mismatch", async () => {
    const report = await new FraudDetectionService().analyzeCampaign({
      campaignId: "location", location: "Kenya",
      backers: ["France", "Brazil", "Japan"].map((location, index) => ({ backerAddress: `G${index}`, pledgeAmount: 1, pledgedAt: new Date().toISOString(), location })),
    });
    expect(report.flags.map((flag) => flag.patternType)).toContain("LOCATION_MISMATCH");
  });
});
