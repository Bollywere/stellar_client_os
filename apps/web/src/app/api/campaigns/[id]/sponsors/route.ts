import { NextRequest, NextResponse } from "next/server";
import { INITIAL_MICK_SPONSORS, calculateSponsorTier, Sponsor } from "@/types/sponsor";

// In-memory store for demo API route
const sponsorsStore: Sponsor[] = [...INITIAL_MOCK_SPONSORS];

// Underwriter configuration for campaign verification insurance
const UNDERWRITER_PARTNERS = [
  { id: "underwriter-carbon-trust", name: "Carbon Trust Verification", coverageRatio: 0.95, premiumRate: 0.025 },
  { id: "underwriter-gold-standard", name: "Gold Standard Foundation", coverageRatio: 0.98, premiumRate: 0.035 },
  { id: "underwriter-verra", name: "Verra Climate Assurance", coverageRatio: 0.9, premiumRate: 0.02 },
] as const;

type UnderwriterPartner = (typeof UNDERWRITER_PARTNERS)[number];

function selectUnderwriter(token: string, amount: number): UnderwriterPartner {
  if (amount >= 10000) {
    return UNDERWRITER_PARTNERS[1];
  }
  if (token.toUpperCase() === "USDT" || token.toUpperCase() === "USDC") {
    return UNDERWRITER_PARTNERS[2];
  }
  return UNDERWRITER_PARTNERS[0];
}

function calculateInsuranceQuote(amount: number, underwriter: UnderwriterPartner) {
  const premium = amount * underwriter.premiumRate;
  const guaranteedCoverage = amount * underwriter.coverageRatio;
  return {
    underwriterId: underwriter.id,
    underwriterName: underwriter.name,
    premium: Number(premium.toFixed(6)),
    guaranteedCoverage: Number(guaranteedCoverage.toFixed(6)),
    coverageRatio: underwriter.coverageRatio,
    status: "active" as const,
    issuedAt: Date.now(),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
+) {
  const { id } = await params;
  const campaignSponsors = sponsorsStore.filter((s) => s.campaignId === id || id === "demo" || id === "camp-101");
  const totalInsured = campaignSponsors.reduce((sum, s) => {
    const amountNum = Number(s.amount);
    if (!Number.finite(amountNum)) return sum;
    const underwriter = selectUnderwriter(s.token, amountNum);
    return sum + amountNum * underwriter.coverageRatio;
  }, 0);
  return NextResponse.json({
    campaignId: id,
    total: campaignSponsors.length,
    sponsors: campaignSponsors,
    insurance: {
      partners: UNDERWRITER_PARTNERS.map((u) => ({ id: u.id, name: u.name, coverageRatio: u.coverageRatio })),
      guaranteedCOTotal: Number(totalInsured.toFixed(6)),
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, address, amount, token, message, avatarUrl, insuranceOptIn } = body;

    if (!address || !amount) {
      return NextResponse.json({ error: "Address and amount are required" }, { status: 400 });
    }

    const amountStr = String(amount);
    const amountNum = Number(amountStr);
    if (!Number.finite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }

    const newSponsor: Sponsor = {
      id: `sp-${Date.now()}`,
      campaignId: id,
      name,
      address,
      avatarUrl,
      amount: amountStr,
      token: token || "XLM",
      tier: calculateSponsorTier(amountStr),
      sponsoredAt: Date.now(),
      message,
      isRecent: true,
    };

    sponsorsStore.unshift(newSponsor);

    const insurance =
      insuranceOptIn === false
        ? null
        : calculateInsuranceQuote(amountNum, selectUnderwriter(newSponsor.token, amountNum));

    return NextResponse.json(
      { success: true, sponsor: newSponsor, insurance },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: "Invalid sponsor payload" }, { status: 500 });
  }
}
