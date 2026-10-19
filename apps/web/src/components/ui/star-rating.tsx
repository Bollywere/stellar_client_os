"use client";

import { useState } from "react";

/** Read-only star display: filled proportionally to the average (AC3). */
export function StarRating({ value, size = 4 }: { value: number | null; size?: 4 | 5 | 6 }) {
  const rounded = value ?? 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-amber-400 text-${size} leading-none`} aria-label={value === null ? "No reviews yet" : `${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.min(Math.max(rounded - (star - 1), 0), 1);
        return (
          <span key={star} className="relative inline-block">
            <span className="text-zinc-700" aria-hidden>★</span>
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }} aria-hidden>
              <span className="text-amber-400">★</span>
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Interactive star picker for the review form (AC2). */
export function StarRatingInput({ value, onChange, id }: { value: number; onChange: (rating: number) => void; id?: string }) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  return (
    <span id={id} className="inline-flex items-center gap-1 text-2xl leading-none" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          className={star <= shown ? "text-amber-400" : "text-zinc-700 hover:text-amber-300"}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
        >
          ★
        </button>
      ))}
    </span>
  );
}
