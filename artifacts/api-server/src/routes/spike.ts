import { Router, type IRouter } from "express";
import {
  EstimateMealBody,
  EstimateMealResponse,
  TrackSpikeEventBody,
  TrackSpikeEventResponse,
} from "@workspace/api-zod";
import { analyzeMeal } from "../lib/meal-ai";

const router: IRouter = Router();
// Bounded, short-lived abuse protection; never stores meals or photos.
const windows = new Map<string, { until: number; count: number }>();
function allowed(key: string, limit: number) {
  const now = Date.now();
  for (const [id, entry] of windows) if (entry.until < now) windows.delete(id);
  const entry = windows.get(key) || { until: now + 60_000, count: 0 };
  if (windows.size > 5000 && !windows.has(key)) return false;
  entry.count++;
  windows.set(key, entry);
  return entry.count <= limit;
}

router.post("/spike/estimate", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = EstimateMealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please enter a meal or choose a supported image." });
    return;
  }
  const { input, text, image } = parsed.data;
  if (
    (input === "photo" && (!image || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))) ||
    (input !== "photo" && !text?.trim())
  ) {
    res.status(400).json({ error: "Please enter a meal or choose a JPEG, PNG or WebP meal photo." });
    return;
  }
  const client = req.ip || "unknown";
  if (!allowed(`estimate:${client}`, 15)) {
    res.status(429).json({ error: "Please wait a minute before analyzing another meal." });
    return;
  }
  try {
    const result = await analyzeMeal(text?.trim(), input === "photo" ? image : undefined);
    res.json(EstimateMealResponse.parse(result));
  } catch (err) {
    // Do not log provider errors, which can contain image/text request bodies.
    req.log.warn({
      kind: err instanceof Error ? err.name : "Unknown",
      status: typeof err === "object" && err !== null && "status" in err ? err.status : undefined,
    }, "Meal analysis unavailable");
    const notFound = err instanceof Error && err.message === "MEAL_NOT_FOUND";
    res.status(notFound ? 400 : 502).json({
      error: notFound
        ? "We couldn't identify a meal. Please describe the foods in the text box."
        : "Meal analysis took too long or is unavailable. Please use the text box and try again.",
    });
  }
});

router.post("/spike/events", async (req, res): Promise<void> => {
  const parsed = TrackSpikeEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid analytics event." });
    return;
  }
  if (!allowed(`events:${req.ip || "unknown"}`, 180)) {
    res.status(429).json({ error: "Too many events." });
    return;
  }
  const { event, distinctId, input, level, fix_type, from, to, count } = parsed.data;
  const required: Record<string, boolean> = {
    meal_logged: !!input,
    spike_estimated: !!level,
    fix_viewed: !!fix_type,
    fix_applied: !!fix_type,
    spike_reduced: !!from && !!to,
    foods_edited: typeof count === "number",
    weekly_view_opened: true,
  };
  if (!distinctId.trim() || !required[event]) {
    res.status(400).json({ error: "Missing event properties." });
    return;
  }
  const token = process.env.MIXPANEL_PROJECT_TOKEN;
  if (!token) {
    res.status(502).json({ error: "Analytics is not configured." });
    return;
  }
  // Allowlisted event properties only: never meal contents, photos or transcripts.
  const fields = event === "meal_logged" ? { input }
    : event === "spike_estimated" ? { level }
    : event === "fix_viewed" || event === "fix_applied" ? { fix_type }
    : event === "spike_reduced" ? { from, to }
    : event === "foods_edited" ? { count } : {};
  try {
    const response = await fetch("https://api.mixpanel.com/track?verbose=1&ip=0", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify([{
        event,
        properties: { token, distinct_id: distinctId, time: Math.floor(Date.now() / 1000), ...fields },
      }]),
    });
    const receipt = await response.json() as { status?: number };
    if (!response.ok || receipt.status !== 1) throw new Error("Analytics delivery failed");
    res.json(TrackSpikeEventResponse.parse({ ok: true }));
  } catch {
    req.log.warn("Analytics delivery unavailable");
    res.status(502).json({ error: "Analytics delivery unavailable." });
  }
});

export default router;
