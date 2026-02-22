import React, { useEffect, useState } from 'react';

export type MetricField = 'weight' | 'reps' | 'distance' | 'duration_seconds' | null;

export function getMetricColumns(metricType?: string): {
  first: { label: string; field: MetricField; unit: string };
  second: { label: string; field: MetricField; unit: string };
} {
  switch (metricType) {
    case 'distance_duration':
      return {
        first: { label: 'KM', field: 'distance', unit: 'km' },
        second: { label: 'Time', field: 'duration_seconds', unit: 's' },
      };
    case 'distance_weight':
      return {
        first: { label: 'KM', field: 'distance', unit: 'km' },
        second: { label: 'kg', field: 'weight', unit: 'kg' },
      };
    case 'duration_weight':
      return {
        first: { label: 'kg', field: 'weight', unit: 'kg' },
        second: { label: 'Time', field: 'duration_seconds', unit: 's' },
      };
    case 'duration':
      return {
        first: { label: 'Time', field: 'duration_seconds', unit: 's' },
        second: { label: '-', field: null, unit: '' },
      };
    case 'reps_only':
      return {
        first: { label: 'Reps', field: 'reps', unit: 'reps' },
        second: { label: '-', field: null, unit: '' },
      };
    case 'weighted_bodyweight':
    case 'weight_reps':
    default:
      return {
        first: { label: 'kg', field: 'weight', unit: 'kg' },
        second: { label: 'Reps', field: 'reps', unit: 'reps' },
      };
  }
}

export const DurationScrollerInput = ({
  valueSeconds,
  onChange,
}: {
  valueSeconds: number;
  onChange: (seconds: number) => void;
}) => {
  const safeSeconds = Math.max(0, Math.floor(valueSeconds || 0));
  const [isOpen, setIsOpen] = useState(false);
  const [draftSeconds, setDraftSeconds] = useState(safeSeconds);

  useEffect(() => {
    if (!isOpen) setDraftSeconds(safeSeconds);
  }, [safeSeconds, isOpen]);

  const hours = Math.floor(draftSeconds / 3600);
  const minutes = Math.floor((draftSeconds % 3600) / 60);
  const seconds = draftSeconds % 60;

  const hourOptions = Array.from({ length: 24 }, (_, value) => value);
  const minuteSecondOptions = Array.from({ length: 60 }, (_, value) => value);

  const formatValue = (value: number) => value.toString().padStart(2, '0');

  const updateDuration = (nextHours: number, nextMinutes: number, nextSeconds: number) => {
    setDraftSeconds((nextHours * 3600) + (nextMinutes * 60) + nextSeconds);
  };

  const commitAndClose = () => {
    onChange(draftSeconds);
    setIsOpen(false);
  };

  const displayDuration = () => {
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = safeSeconds % 60;
    return `${formatValue(h)}:${formatValue(m)}:${formatValue(s)}`;
  };

  const selectClassName = 'h-11 w-full rounded-lg border border-border-subtle bg-surface px-2 text-center text-sm font-semibold tabular-nums text-text-main outline-none';

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="h-10 w-full rounded-md border border-border-subtle bg-surface px-2 text-center text-xs font-semibold tabular-nums text-text-main"
      >
        {displayDuration()}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-end justify-center"
          onClick={commitAndClose}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-border-subtle bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-main uppercase tracking-wide">Set Time</h3>
              <button
                type="button"
                onClick={commitAndClose}
                className="text-xs font-semibold text-text-muted"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <select
                aria-label="Hours"
                value={hours}
                className={selectClassName}
                onChange={(e) => updateDuration(Number(e.target.value), minutes, seconds)}
              >
                {hourOptions.map((value) => (
                  <option key={`h-${value}`} value={value}>{formatValue(value)}h</option>
                ))}
              </select>
              <select
                aria-label="Minutes"
                value={minutes}
                className={selectClassName}
                onChange={(e) => updateDuration(hours, Number(e.target.value), seconds)}
              >
                {minuteSecondOptions.map((value) => (
                  <option key={`m-${value}`} value={value}>{formatValue(value)}m</option>
                ))}
              </select>
              <select
                aria-label="Seconds"
                value={seconds}
                className={selectClassName}
                onChange={(e) => updateDuration(hours, minutes, Number(e.target.value))}
              >
                {minuteSecondOptions.map((value) => (
                  <option key={`s-${value}`} value={value}>{formatValue(value)}s</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={commitAndClose}
              className="mt-4 w-full rounded-xl bg-brand text-white py-3 text-sm font-bold"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
};
