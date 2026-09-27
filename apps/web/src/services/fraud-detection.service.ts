/**
 * AI Fraud Detection & Pattern Prevention Service — Issue #796
 *
 * ML-based fraud detection engine flagging suspicious patterns:
 * fake backers, duplicate accounts, money laundering patterns, and circular transactions.
 * Automatically suspends campaigns with critical risk scores (> 80).
 */

import {
  AnalyzeCampaignInput,
  CampaignSecurityStatus,
  FraudDetectionReport,
  FraudPatternType,
  RiskLevel,
  SuspiciousActivityFlag,
} from '@/types/fraud-detection';

export class FraudDetectionService {
  private reports: Map<string, FraudDetectionReport> = new Map();
  private securityStatuses: Map<string, CampaignSecurityStatus> = new Map();

  /**
   * Analyze campaign backers and transaction patterns using AI/ML heuristics.
   */
  public async analyzeCampaign(input: AnalyzeCampaignInput): Promise<FraudDetectionReport> {
    const flags: SuspiciousActivityFlag[] = [];
    const backers = input.backers || [];
    const transactions = input.transactions || [];
    const addFlag = (patternType: FraudPatternType, description: string, severityScore: number, evidenceDetails: Record<string, unknown>) => {
      flags.push({
        id: `flag-${patternType.toLowerCase()}-${Date.now()}-${flags.length}`,
        patternType,
        description,
        severityScore,
        evidenceDetails,
        detectedAt: new Date().toISOString(),
      });
    };

    // Unrealistic planting claims relative to time and target.
    if (input.treeCount !== undefined && input.treeCount >= 0) {
      const duration = Math.max(1, input.campaignDurationDays ?? 30);
      const treesPerDay = input.treeCount / duration;
      const targetRatio = input.targetTrees && input.targetTrees > 0 ? input.treeCount / input.targetTrees : 0;
      if (treesPerDay > 10_000 || targetRatio > 10) {
        addFlag('UNREALISTIC_TREE_COUNT', 'Reported tree count is inconsistent with the campaign duration or target.', 82, {
          treeCount: input.treeCount, targetTrees: input.targetTrees ?? null, campaignDurationDays: duration, treesPerDay,
        });
      }
    }

    // Reused verifier identities or verified totals exceeding the claim.
    const verifications = input.verifications ?? [];
    const verifierIds = verifications.map((item) => item.verifierId).filter(Boolean) as string[];
    const duplicateVerifier = verifierIds.length !== new Set(verifierIds).size;
    const verifiedTreeTotal = verifications.filter((item) => item.status === 'verified').reduce((sum, item) => sum + (item.treeCount ?? 0), 0);
    if (duplicateVerifier || (input.treeCount !== undefined && verifiedTreeTotal > input.treeCount)) {
      addFlag('SUSPICIOUS_VERIFICATION', 'Verification records contain repeated verifier identities or exceed the campaign tree claim.', 78, {
        duplicateVerifier, verificationCount: verifications.length, verifiedTreeTotal, treeCount: input.treeCount ?? null,
      });
    }

    // Bot-like sponsor identity and verification signals.
    const botSignals = backers.filter((backer) => backer.verificationStatus === 'failed' || (backer.accountAgeDays !== undefined && backer.accountAgeDays < 1)).length;
    const userAgents = backers.map((backer) => backer.userAgent).filter(Boolean) as string[];
    const repeatedUserAgent = userAgents.length > 2 && new Set(userAgents).size < userAgents.length / 2;
    if (botSignals >= 3 || repeatedUserAgent) {
      addFlag('BOT_SPONSORS', 'Sponsor profiles show concentrated bot-like identity or verification signals.', 80, {
        botSignals, repeatedUserAgent, sponsorCount: backers.length,
      });
    }

    // Only flag a location mismatch when a meaningful share of samples agrees.
    if (input.location && backers.length > 0) {
      const expected = input.location.trim().toLowerCase();
      const mismatches = backers.filter((backer) => backer.location && !backer.location.toLowerCase().includes(expected)).length;
      if (mismatches >= Math.max(2, Math.ceil(backers.length * 0.5))) {
        addFlag('LOCATION_MISMATCH', 'Sponsor location samples do not match the campaign location.', 68, {
          campaignLocation: input.location, mismatches, sampledSponsors: backers.length,
        });
      }
    }

    // 1. Detect Fake Backers & Bot Clusters (e.g. many pledges created within same minute)
    if (backers.length > 5) {
      const timestamps = backers.map((b) => new Date(b.pledgedAt).getTime()).sort();
      let rapidPledgeCount = 0;
      for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] - timestamps[i - 1] < 10_000) {
          // pledges within 10 seconds
          rapidPledgeCount++;
        }
      }

      if (rapidPledgeCount >= 3) {
        flags.push({
          id: `flag-fb-${Date.now()}`,
          patternType: 'FAKE_BACKERS',
          description: 'High pledge velocity detected: Multiple backer pledges within seconds.',
          severityScore: 75,
          evidenceDetails: { rapidPledgeCount, totalBackers: backers.length },
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 2. Detect Duplicate Accounts & IP Clustering
    const ipCounts: Record<string, number> = {};
    for (const b of backers) {
      if (b.ipAddress) {
        ipCounts[b.ipAddress] = (ipCounts[b.ipAddress] || 0) + 1;
      }
    }

    const clusteredIps = Object.entries(ipCounts).filter(([_, count]) => count >= 3);
    if (clusteredIps.length > 0) {
      flags.push({
        id: `flag-ip-${Date.now()}`,
        patternType: 'DUPLICATE_ACCOUNTS',
        description: 'Multiple backer accounts originating from identical IP address.',
        severityScore: 85,
        evidenceDetails: { clusteredIps },
        detectedAt: new Date().toISOString(),
      });
    }

    // 3. Detect Money Laundering / Circular Transactions
    if (input.creatorAddress && transactions.length > 0) {
      const creatorAddr = input.creatorAddress.toLowerCase();
      const circularTxs = transactions.filter(
        (tx) => tx.from.toLowerCase() === creatorAddr || tx.to.toLowerCase() === creatorAddr
      );

      if (circularTxs.length >= 2) {
        flags.push({
          id: `flag-ml-${Date.now()}`,
          patternType: 'MONEY_LAUNDERING',
          description: 'Circular transaction flow between campaign creator and backers.',
          severityScore: 90,
          evidenceDetails: { circularCount: circularTxs.length },
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Calculate overall risk score
    let overallRiskScore = 0;
    if (flags.length > 0) {
      const maxScore = Math.max(...flags.map((f) => f.severityScore));
      overallRiskScore = Math.min(100, Math.round(maxScore + (flags.length - 1) * 5));
    }

    let riskLevel: RiskLevel = 'LOW';
    if (overallRiskScore >= 80) riskLevel = 'CRITICAL';
    else if (overallRiskScore >= 60) riskLevel = 'HIGH';
    else if (overallRiskScore >= 35) riskLevel = 'MEDIUM';

    const recommendation =
      overallRiskScore >= 80 ? 'AUTO_SUSPEND' : overallRiskScore >= 50 ? 'REVIEW' : 'PASS';

    const isSuspended = recommendation === 'AUTO_SUSPEND';

    const report: FraudDetectionReport = {
      campaignId: input.campaignId,
      overallRiskScore,
      riskLevel,
      flags,
      isSuspended,
      analyzedBackerCount: backers.length,
      analyzedTxCount: transactions.length,
      scannedAt: new Date().toISOString(),
      recommendation,
    };

    this.reports.set(input.campaignId, report);

    if (isSuspended) {
      await this.suspendCampaign(
        input.campaignId,
        `Auto-suspended by AI Fraud Prevention system (Risk Score: ${overallRiskScore})`
      );
    } else {
      if (!this.securityStatuses.has(input.campaignId)) {
        this.securityStatuses.set(input.campaignId, {
          campaignId: input.campaignId,
          status: flags.length > 0 ? 'FLAGGED' : 'ACTIVE',
        });
      }
    }

    return report;
  }

  /**
   * Get latest fraud analysis report for a campaign.
   */
  public async getFraudReport(campaignId: string): Promise<FraudDetectionReport | null> {
    return this.reports.get(campaignId) || null;
  }

  /**
   * Get campaign security status.
   */
  public async getSecurityStatus(campaignId: string): Promise<CampaignSecurityStatus> {
    return (
      this.securityStatuses.get(campaignId) || {
        campaignId,
        status: 'ACTIVE',
      }
    );
  }

  /**
   * Suspend a flagged campaign.
   */
  public async suspendCampaign(campaignId: string, reason: string): Promise<CampaignSecurityStatus> {
    const status: CampaignSecurityStatus = {
      campaignId,
      status: 'SUSPENDED',
      suspendedAt: new Date().toISOString(),
      reason,
    };

    this.securityStatuses.set(campaignId, status);

    const report = this.reports.get(campaignId);
    if (report) {
      report.isSuspended = true;
      report.recommendation = 'AUTO_SUSPEND';
    }

    return status;
  }
}

export const fraudDetectionService = new FraudDetectionService();
