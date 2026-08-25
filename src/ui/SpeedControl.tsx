import { useEffect, useRef, useState } from "react";
import { simulation } from "../simulation";
import {
  DEFAULT_SPEED_EXPONENT,
  J2000_EPOCH_MS,
  MAX_SPEED_EXPONENT,
  SECONDS_PER_YEAR,
  secondsSinceJ2000,
} from "../astronomy";
import styles from "./SpeedControl.module.css";

// simulation.speed is "simulated seconds elapsed per real second" — this
// expresses that as a duration in whatever unit reads best, so 1x shows as
// "1 second" (literal real time) and the top of the slider shows as however
// many days/years of orbital motion play out per second of wall-clock time.
const TIME_UNITS = [
  { label: "second", seconds: 1 },
  { label: "minute", seconds: 60 },
  { label: "hour", seconds: 3600 },
  { label: "day", seconds: 86_400 },
  { label: "year", seconds: SECONDS_PER_YEAR },
];

function formatSpeed(secondsPerRealSecond: number) {
  let unit = TIME_UNITS[0];
  for (const candidate of TIME_UNITS) {
    if (secondsPerRealSecond / candidate.seconds >= 1) unit = candidate;
  }
  const value = secondsPerRealSecond / unit.seconds;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit.label}${rounded === 1 ? "" : "s"} per second`;
}

// datetime-local's value has no timezone designator, so both directions
// (format for the input, parse the input back) go through local-time Date
// fields rather than toISOString/Date.parse, which are UTC.
function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function SpeedControl() {
  // Mirrors simulation.speed for display only — the frame loop reads the
  // shared object directly, so dragging the slider doesn't re-render the Canvas tree.
  const [exponent, setExponent] = useState(DEFAULT_SPEED_EXPONENT);
  // Written directly via ref every animation frame rather than through React
  // state — this component lives outside the Canvas (no useFrame), and at
  // high playback speeds the date needs to visibly tick every frame, not
  // just once a second; routing that through setState would re-render this
  // whole component just to update one line of text.
  const dateRef = useRef<HTMLDivElement>(null);
  // Editing a custom date is rare interactive React state (unlike the ticking
  // display above) — a controlled input needs to re-render on keystrokes anyway.
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [dateInputValue, setDateInputValue] = useState("");

  useEffect(() => {
    if (isEditingDate) return;
    let frame: number;
    const update = () => {
      if (dateRef.current) {
        const date = new Date(J2000_EPOCH_MS + simulation.time * 1000);
        dateRef.current.textContent = date.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "medium",
        });
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [isEditingDate]);

  const startEditingDate = () => {
    setDateInputValue(
      toDatetimeLocalValue(new Date(J2000_EPOCH_MS + simulation.time * 1000)),
    );
    setIsEditingDate(true);
  };

  const commitDateEdit = () => {
    const parsed = new Date(dateInputValue);
    if (!Number.isNaN(parsed.getTime())) {
      simulation.time = secondsSinceJ2000(parsed);
    }
    setIsEditingDate(false);
  };

  return (
    <div className={styles.container}>
      {isEditingDate ? (
        <input
          type="datetime-local"
          step={1}
          value={dateInputValue}
          autoFocus
          onChange={(event) => setDateInputValue(event.target.value)}
          onBlur={commitDateEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDateEdit();
            if (event.key === "Escape") setIsEditingDate(false);
          }}
          className={styles.dateInput}
        />
      ) : (
        <div
          ref={dateRef}
          onClick={startEditingDate}
          title="Click to set a custom date/time"
          className={styles.dateDisplay}
        />
      )}
      <label htmlFor="speed-slider">
        Time scale: {formatSpeed(10 ** exponent)}
      </label>
      <input
        id="speed-slider"
        type="range"
        min={0}
        max={MAX_SPEED_EXPONENT}
        step={0.01}
        value={exponent}
        onChange={(event) => {
          const next = Number(event.target.value);
          setExponent(next);
          simulation.speed = 10 ** next;
        }}
        className={styles.speedSlider}
      />
    </div>
  );
}
