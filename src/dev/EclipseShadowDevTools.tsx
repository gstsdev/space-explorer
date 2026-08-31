import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  applyEclipseShadowConfig,
  ECLIPSE_SHADOW_DEFAULTS,
  eclipseShadowConfig,
} from "../eclipseShadowConfig";
import type { EclipseShadowConfig } from "../eclipseShadowConfig";

// Dev-only live tuner for this app's two analytic eclipse shadows — Earth's
// (the Moon's shadow during a solar eclipse) and the Moon's (Earth's shadow
// during a lunar eclipse). Every slider writes straight through to the
// mutable `eclipseShadowConfig` object, which TexturedSurface/MoonSurface
// read into their shader uniforms every frame, so changes show instantly
// without a re-render of the Canvas tree.
//
// Mounted only behind `import.meta.env.DEV` in App.tsx. Because that guard
// makes this module's import unused in a production build, and because this
// file has no side-effectful imports (inline styles, not a CSS module — the
// one reason it diverges from the rest of src/ui/), Rollup drops the whole
// thing from the production bundle. Toggle the panel with Ctrl/Cmd+Shift+D.

const NUMERIC_FIELDS = {
  earth: [
    { key: "penumbraScale", label: "Penumbra softness", min: 0.1, max: 6, step: 0.05 },
    { key: "casterRadiusScale", label: "Umbra size (Moon radius ×)", min: 0.3, max: 2.5, step: 0.01 },
    { key: "shadowStrength", label: "Shadow strength", min: 0, max: 1, step: 0.01 },
  ],
  moon: [
    { key: "penumbraScale", label: "Penumbra softness", min: 0.1, max: 6, step: 0.05 },
    { key: "casterRadiusScale", label: "Umbra size (Earth radius ×)", min: 0.3, max: 2.5, step: 0.01 },
    { key: "shadowStrength", label: "Shadow strength", min: 0, max: 1, step: 0.01 },
    { key: "bloodMoonIntensity", label: "Blood-moon glow", min: 0, max: 1, step: 0.01 },
    { key: "umbraCenterDarkening", label: "Umbra centre darkening", min: 0.05, max: 1, step: 0.01 },
    { key: "umbraGradientCurve", label: "Umbra gradient curve", min: 0.1, max: 3, step: 0.05 },
  ],
} as const;

function rgbToHex([r, g, b]: [number, number, number]): string {
  const channel = (x: number) =>
    Math.round(Math.min(Math.max(x, 0), 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function cloneConfig(source: EclipseShadowConfig): EclipseShadowConfig {
  return {
    earth: { ...source.earth },
    moon: {
      ...source.moon,
      bloodMoonColor: [...source.moon.bloodMoonColor],
      bloodMoonEdgeColor: [...source.moon.bloodMoonEdgeColor],
    },
  };
}

const num = (x: number) => Number(x.toFixed(3)).toString();

const triple = (c: readonly [number, number, number]) => `[${c.map((v) => v.toFixed(3)).join(", ")}]`;

function buildSnippet(values: EclipseShadowConfig): string {
  const { earth, moon } = values;
  return `// src/eclipseShadowConfig.ts — paste into ECLIPSE_SHADOW_DEFAULTS
earth: {
  penumbraScale: ${num(earth.penumbraScale)},
  casterRadiusScale: ${num(earth.casterRadiusScale)},
  shadowStrength: ${num(earth.shadowStrength)},
},
moon: {
  penumbraScale: ${num(moon.penumbraScale)},
  casterRadiusScale: ${num(moon.casterRadiusScale)},
  shadowStrength: ${num(moon.shadowStrength)},
  bloodMoonColor: ${triple(moon.bloodMoonColor)},
  bloodMoonEdgeColor: ${triple(moon.bloodMoonEdgeColor)},
  bloodMoonIntensity: ${num(moon.bloodMoonIntensity)},
  umbraCenterDarkening: ${num(moon.umbraCenterDarkening)},
  umbraGradientCurve: ${num(moon.umbraGradientCurve)},
},`;
}

const panelStyle: CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 50,
  width: 288,
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(12, 14, 20, 0.92)",
  border: "1px solid rgba(255, 255, 255, 0.14)",
  color: "#e8eaf0",
  font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  backdropFilter: "blur(6px)",
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.45)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
  fontWeight: 700,
  letterSpacing: 0.3,
};

const sectionLabelStyle: CSSProperties = {
  margin: "10px 0 4px",
  textTransform: "uppercase",
  fontSize: 10,
  letterSpacing: 1,
  color: "rgba(255, 255, 255, 0.55)",
};

const rowStyle: CSSProperties = { marginBottom: 6 };
const rowHeadStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8 };
const valueStyle: CSSProperties = { color: "#8fd0c0" };

const buttonRowStyle: CSSProperties = { display: "flex", gap: 6, marginTop: 10 };
const buttonStyle: CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255, 255, 255, 0.18)",
  background: "rgba(255, 255, 255, 0.06)",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

const hintStyle: CSSProperties = { marginTop: 8, fontSize: 10, color: "rgba(255, 255, 255, 0.4)" };

type Body = keyof typeof NUMERIC_FIELDS;

export function EclipseShadowDevTools() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<EclipseShadowConfig>(() => cloneConfig(eclipseShadowConfig));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const snippet = useMemo(() => buildSnippet(values), [values]);

  if (!open) return null;

  // Single write path: push the whole next config into the live object
  // (which the shaders read every frame) and mirror it in local state.
  const commit = (next: EclipseShadowConfig) => {
    applyEclipseShadowConfig(next);
    setValues(next);
  };

  const setNumeric = (body: Body, key: string, raw: number) => {
    const value = Number.isFinite(raw) ? raw : 0;
    commit({ ...values, [body]: { ...values[body], [key]: value } });
  };

  const setMoonColor = (key: "bloodMoonColor" | "bloodMoonEdgeColor", hex: string) => {
    commit({ ...values, moon: { ...values.moon, [key]: hexToRgb(hex) } });
  };

  const reset = () => commit(cloneConfig(ECLIPSE_SHADOW_DEFAULTS));

  const copy = () => {
    void navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const renderNumeric = (body: Body) =>
    NUMERIC_FIELDS[body].map((field) => {
      const value = (values[body] as unknown as Record<string, number>)[field.key];
      return (
        <label key={field.key} style={rowStyle}>
          <span style={rowHeadStyle}>
            <span>{field.label}</span>
            <span style={valueStyle}>{value.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value}
            onChange={(event) => setNumeric(body, field.key, event.target.valueAsNumber)}
            style={{ width: "100%" }}
          />
        </label>
      );
    });

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>Eclipse shadows</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{ ...buttonStyle, flex: "none", padding: "2px 7px" }}
        >
          ×
        </button>
      </div>

      <div style={sectionLabelStyle}>Earth · solar eclipse</div>
      {renderNumeric("earth")}

      <div style={sectionLabelStyle}>Moon · lunar eclipse</div>
      {renderNumeric("moon")}
      <label style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Umbra centre colour</span>
        <input
          type="color"
          value={rgbToHex(values.moon.bloodMoonColor)}
          onChange={(event) => setMoonColor("bloodMoonColor", event.target.value)}
        />
      </label>
      <label style={{ ...rowStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Umbra edge colour</span>
        <input
          type="color"
          value={rgbToHex(values.moon.bloodMoonEdgeColor)}
          onChange={(event) => setMoonColor("bloodMoonEdgeColor", event.target.value)}
        />
      </label>

      <div style={buttonRowStyle}>
        <button type="button" onClick={reset} style={buttonStyle}>
          Reset
        </button>
        <button type="button" onClick={copy} style={buttonStyle}>
          {copied ? "Copied ✓" : "Copy values"}
        </button>
      </div>

      <div style={hintStyle}>Ctrl/Cmd+Shift+D toggles this panel · dev build only</div>
    </div>
  );
}
