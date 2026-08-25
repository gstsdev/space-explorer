// Render quality tier — currently governs two costs diagnosed as genuinely
// prohibitive on weak mobile GPUs (a Galaxy A16/Mali-G57 crashed/struggled
// where an iPhone 15 and desktop didn't): Planet/Clouds.tsx's procedural
// noise shader complexity, and which skybox texture resolution loads. Not a
// general "mobile mode" — viewport size/UA alone don't predict this (the
// iPhone 15 is also "mobile" and needs no downgrade at all).
export type Quality = "low" | "high";
export type QualityPreference = "auto" | Quality;

const STORAGE_KEY = "space-explorer:quality";

// Best-effort heuristic, not a GPU capability database — deliberately short
// and specific rather than broad, since broad substring matches (e.g.
// "adreno 6") would misclassify genuinely capable chips in the same family
// as the confirmed-weak ones. Seeded with the Mali-G57 MC2 (Galaxy A16,
// MediaTek Helio G99) that actually crashed/struggled this session, plus a
// few adjacent low-end mobile GPUs. Unmatched (including browsers that don't
// expose deviceMemory or WEBGL_debug_renderer_info, e.g. some Safari
// versions) defaults to "high": an unrecognized GPU is more likely
// mid-range-or-better than not, and the Settings quality override is the
// real safety net for whatever this list misses in either direction —
// expand it as new weak devices turn up rather than trying to be exhaustive
// up front.
const LOW_END_GPU_PATTERNS = [
  "mali-g57",
  "mali-g52",
  "mali-g51",
  "mali-g31",
  "mali-t",
  "adreno 610",
  "adreno 612",
  "adreno 613",
  "adreno 619",
  "adreno 505",
  "adreno 506",
  "adreno 508",
  "adreno 509",
  "adreno 512",
  "powervr",
];

function detectGpuRendererString(): string | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
  if (!gl || !(gl instanceof WebGLRenderingContext)) return null;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return null;
  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  return typeof renderer === "string" ? renderer.toLowerCase() : null;
}

export function detectDefaultQuality(): Quality {
  // navigator.deviceMemory (Chrome/Android only, in GB) is a strong signal
  // on its own when present.
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === "number" && deviceMemory <= 4) return "low";

  const renderer = detectGpuRendererString();
  if (renderer && LOW_END_GPU_PATTERNS.some((pattern) => renderer.includes(pattern))) {
    return "low";
  }

  return "high";
}

export function getStoredQualityPreference(): QualityPreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "auto" || stored === "low" || stored === "high") return stored;
  return "auto";
}

export function setStoredQualityPreference(preference: QualityPreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
}

export function resolveQuality(preference: QualityPreference): Quality {
  return preference === "auto" ? detectDefaultQuality() : preference;
}
