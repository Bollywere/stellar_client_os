import { getCampaign, transitionCampaignStatus } from "../../../../services/campaign.service";
import { autoTranslate, detectLanguage, SUPPORTED_TRANSLATION_LOCALES } from "@/lib/translation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const regalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
function noStore<T>(body: T, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) } });
}

export async function GET((_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const campaign = await getCampaign((await params).id);
  return campaign ? noStore(campaign) : noStore({ error: "Campaign not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const campaign = await getCampaign(id);
  if (!campaign) return noStore({ error: "Campaign not found" }, { status: 404 });

  try {
    const body = await request.json() as {
      status?: never;
      changedBy?: string;
      reason?: string;
      name?: string;
      description?: string;
      language?: string;
      translations?: Record<string, string>;
      autoTranslate?: boolean;
      treeCount?: number;
      co2Sequestration?: string;
      countries?: string[];
      location?: string;
    };
    if (body.treeCount !== undefined && (!Number.isSafeInteger(body.treeCount) || body.treeCount < 0)) {
      return noStore({ error: "treeCount must be a non-negative whole number" }, { status: 400 });
    }
    if (body.co2Sequestration !== undefined && (
      typeof body.co2Sequestration !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(body.co2Sequestration) ||
      !Number.isFinite(Number(body.co2Sequestration))
    )) {
      return noStore({ error: "co2Sequestration must be a non-negative decimal string in metric tonnes" }, { status: 400 });
    }
    if (body.countries !== undefined && (!Array.isArray(body.countries) || body.countries.some((c) => typeof c !== "string"))) {
      return noStore({ error: "countries must be an array of strings" }, { status: 400 });
    }
    if (body.location !== undefined && typeof body.location !== "string") {
      return noStore({ error: "location must be a string" }, { status: 400 });
    }
    let updated = campaign;
    if (body.status) {
      if (!body.changedBy) return noStore({ error: "changedBy is required when changing status" }, { status: 400 });
      updated = await transitionCampaignStatus(campaign, body.status, body.changedBy, body.reason);
    }
    if (body.name !== undefined || body.description !== undefined || body.language !== undefined || body.translations !== undefined || body.autoTranslate !== undefined || body.treeCount !== undefined || body.co2Sequestration !== undefined || body.countries !== undefined || body.location !== undefined) {
      const language = body.language ?? updated.language ?? detectLanguage(body.description ?? updated.description ?? "");
      let translations = body.translations ?? updated.translations ?? {};
      const description = body.description ?? updated.description ?? "";
      if (body.autoTranslate) {
        translations = {
          ...autoTranslate(description, SUPPORTED_TRANSLATION_LOCALES),
          ...translations,
        };
      }
      updated = await (await import("@/services/campaign.service")).getCampaignDataSource().saveCampaign({
        ...updated,
        name: body.name ?? updated.name,
        description,
        language,
        translations,
        treeCount: body.treeCount ?? updated.treeCount,
        co2Sequestration: body.co2Sequestration ?? updated.co2Sequestration,
        countries: body.countries ?? updated.countries,
        location: body.location ?? updated.location,
        updatedAt: Date.now(),
      });
    }
    return noStore(updated);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Invalid JSON request body" }, { status: 400 });
  }
}
