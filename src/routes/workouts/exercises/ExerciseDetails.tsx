import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../lib/db';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import RouteHeader from '../../../lib/components/RouteHeader';

type WorkoutMediaEntry = {
  sourceId: string;
  videoPath: string;
  thumbnailPath: string | null;
};

type WorkoutMediaMap = {
  media?: WorkoutMediaEntry[];
};

type HistorySetRow = {
  workoutId: string;
  workoutName: string;
  workoutDate: string;
  setNumber: number;
  weight: number;
  reps: number;
  volume: number;
  estimated1RM: number;
};

type SummaryChartMetric = 'heaviest' | 'setVolume';

const toWorkoutMediaUrl = (path?: string | null) => {
  if (!path) return '';
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\/+/, '')}`;
};

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mediaNameFromVideoPath = (videoPath: string) => {
  const file = videoPath.split('/').pop() || videoPath;
  const noExt = file.replace(/\.mp4$/i, '');
  const noPrefix = noExt.replace(/^\d+-/, '');
  const noSuffix = noPrefix.replace(/-(chest|back|thighs|shoulders|shoulder|upper-arms|lower-arms|waist|hips|calves|plyometrics)$/i, '');
  const noGender = noSuffix.replace(/-(female|male)$/i, '');
  return normalizeName(noGender.replace(/-/g, ' '));
};

const toSafeNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (iso?: string) => {
  if (!iso) return '-';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
};

const formatDateTime = (iso?: string) => {
  if (!iso) return '-';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
};

const estimateOneRepMax = (weight: number, reps: number) => {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  if (reps >= 37) return 0;
  return weight * (36 / (37 - reps));
};

export default function ExerciseDetails() {
  const { id } = useParams();
  const { pop } = useStackNavigation();
  const [fallback, setFallback] = useState<{ videoPath?: string; thumbnailPath?: string }>({});
  const [activeTab, setActiveTab] = useState<'summary' | 'history'>('summary');
  const [summaryChartMetric, setSummaryChartMetric] = useState<SummaryChartMetric>('heaviest');
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);

  const exercise = useLiveQuery(async () => {
    if (!id) return undefined;
    return db.workout_exercises_def.get(id);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const resolveFallbackMedia = async () => {
      if (!exercise) {
        setFallback({});
        return;
      }

      if (exercise.thumbnail_path) {
        setFallback({});
        return;
      }

      try {
        const response = await fetch(toWorkoutMediaUrl('workouts/media-map.json'), { cache: 'no-cache' });
        if (!response.ok) return;
        const mediaMap = (await response.json()) as WorkoutMediaMap;
        const mediaEntries = mediaMap.media || [];

        const bySourceId = new Map(mediaEntries.map((entry) => [entry.sourceId, entry]));
        const byNormalizedName = mediaEntries.map((entry) => ({
          entry,
          normalizedName: mediaNameFromVideoPath(entry.videoPath)
        }));

        let matched: WorkoutMediaEntry | undefined;
        if (exercise.source_id) {
          matched = bySourceId.get(exercise.source_id);
        }

        if (!matched) {
          const normalizedExerciseName = normalizeName(exercise.name || '');
          matched = byNormalizedName.find((item) =>
            item.normalizedName === normalizedExerciseName ||
            item.normalizedName.includes(normalizedExerciseName) ||
            normalizedExerciseName.includes(item.normalizedName)
          )?.entry;
        }

        if (!cancelled && matched) {
          setFallback({
            videoPath: matched.videoPath,
            thumbnailPath: matched.thumbnailPath || undefined,
          });
        }
      } catch {
        // no-op fallback
      }
    };

    void resolveFallbackMedia();
    return () => {
      cancelled = true;
    };
  }, [exercise]);

  const imageUrl = useMemo(() => {
    return toWorkoutMediaUrl(exercise?.thumbnail_path || fallback.thumbnailPath);
  }, [exercise?.thumbnail_path, fallback.thumbnailPath]);

  const videoUrl = useMemo(() => {
    return toWorkoutMediaUrl(exercise?.video_path || fallback.videoPath);
  }, [exercise?.video_path, fallback.videoPath]);

  const historyData = useLiveQuery(async () => {
    if (!id) return null;

    const logEntries = await db.workout_log_entries.where('exercise_id').equals(id).toArray();
    if (!logEntries.length) {
      return {
        rows: [] as HistorySetRow[],
        workoutCount: 0,
        totalSets: 0,
        lastPerformedAt: '',
        heaviest: null as HistorySetRow | null,
        best1RM: null as HistorySetRow | null,
        bestSetVolume: null as HistorySetRow | null,
        mostReps: null as HistorySetRow | null,
        latestBestVolume: 0,
        previousBestVolume: 0,
      };
    }

    const workoutIds = Array.from(new Set(logEntries.map((entry) => entry.workout_id)));
    const workouts = await db.workouts.where('id').anyOf(workoutIds).toArray();
    const workoutMap = new Map(workouts.map((workout) => [workout.id, workout]));

    const entryIds = logEntries.map((entry) => entry.id);
    const sets = await db.workout_sets.where('workout_log_entry_id').anyOf(entryIds).toArray();

    const rows: HistorySetRow[] = [];
    for (const set of sets) {
      const includeSet = set.completed ?? true;
      if (!includeSet) continue;

      const entry = logEntries.find((item) => item.id === set.workout_log_entry_id);
      if (!entry) continue;

      const workout = workoutMap.get(entry.workout_id);
      const weight = toSafeNumber(set.weight);
      const reps = toSafeNumber(set.reps);

      rows.push({
        workoutId: entry.workout_id,
        workoutName: workout?.name?.trim() || 'Workout',
        workoutDate: workout?.start_time || '',
        setNumber: toSafeNumber(set.set_number),
        weight,
        reps,
        volume: weight * reps,
        estimated1RM: estimateOneRepMax(weight, reps),
      });
    }

    rows.sort((a, b) => {
      if (a.workoutDate !== b.workoutDate) return a.workoutDate < b.workoutDate ? 1 : -1;
      return a.setNumber - b.setNumber;
    });

    const heaviest = rows.reduce<HistorySetRow | null>((best, row) => {
      if (!best) return row;
      return row.weight > best.weight ? row : best;
    }, null);

    const best1RM = rows.reduce<HistorySetRow | null>((best, row) => {
      if (!best) return row;
      return row.estimated1RM > best.estimated1RM ? row : best;
    }, null);

    const bestSetVolume = rows.reduce<HistorySetRow | null>((best, row) => {
      if (!best) return row;
      return row.volume > best.volume ? row : best;
    }, null);

    const mostReps = rows.reduce<HistorySetRow | null>((best, row) => {
      if (!best) return row;
      return row.reps > best.reps ? row : best;
    }, null);

    const rowsByWorkout = new Map<string, HistorySetRow[]>();
    for (const row of rows) {
      const existing = rowsByWorkout.get(row.workoutId) || [];
      existing.push(row);
      rowsByWorkout.set(row.workoutId, existing);
    }

    const workoutDateById = new Map<string, string>();
    for (const row of rows) {
      if (!workoutDateById.has(row.workoutId)) {
        workoutDateById.set(row.workoutId, row.workoutDate);
      }
    }

    const sortedWorkoutIds = Array.from(rowsByWorkout.keys()).sort((a, b) => {
      const dateA = workoutDateById.get(a) || '';
      const dateB = workoutDateById.get(b) || '';
      if (dateA === dateB) return 0;
      return dateA < dateB ? 1 : -1;
    });

    const latestWorkoutId = sortedWorkoutIds[0];
    const latestBestVolume = latestWorkoutId
      ? Math.max(...(rowsByWorkout.get(latestWorkoutId) || []).map((row) => row.volume), 0)
      : 0;

    const previousWorkoutRows = sortedWorkoutIds.slice(1).flatMap((workoutId) => rowsByWorkout.get(workoutId) || []);
    const previousBestVolume = previousWorkoutRows.length
      ? Math.max(...previousWorkoutRows.map((row) => row.volume), 0)
      : 0;

    const lastPerformedAt = rows[0]?.workoutDate || '';

    return {
      rows,
      workoutCount: rowsByWorkout.size,
      totalSets: rows.length,
      lastPerformedAt,
      heaviest,
      best1RM,
      bestSetVolume,
      mostReps,
      latestBestVolume,
      previousBestVolume,
    };
  }, [id]);

  const historyByWorkout = useMemo(() => {
    const grouped = new Map<string, { workoutId: string; workoutName: string; workoutDate: string; sets: HistorySetRow[] }>();
    const rows = historyData?.rows || [];

    for (const row of rows) {
      const existing = grouped.get(row.workoutId);
      if (existing) {
        existing.sets.push(row);
      } else {
        grouped.set(row.workoutId, {
          workoutId: row.workoutId,
          workoutName: row.workoutName,
          workoutDate: row.workoutDate,
          sets: [row],
        });
      }
    }

    for (const group of grouped.values()) {
      group.sets.sort((a, b) => a.setNumber - b.setNumber);
    }

    return Array.from(grouped.values());
  }, [historyData?.rows]);

  const summaryChartData = useMemo(() => {
    const workouts = [...historyByWorkout]
      .sort((a, b) => {
        if (a.workoutDate === b.workoutDate) return 0;
        return a.workoutDate < b.workoutDate ? -1 : 1;
      })
      .map((group) => {
        const heaviest = Math.max(...group.sets.map((set) => set.weight), 0);
        const setVolume = group.sets.reduce((sum, set) => sum + set.volume, 0);

        const metricValue = summaryChartMetric === 'heaviest' ? heaviest : setVolume;

        return {
          workoutId: group.workoutId,
          workoutName: group.workoutName,
          workoutDate: group.workoutDate,
          label: formatDate(group.workoutDate),
          value: metricValue,
        };
      });

    const maxValue = Math.max(...workouts.map((item) => item.value), 0);
    const minValue = Math.min(...workouts.map((item) => item.value), 0);
    const range = maxValue - minValue;

    const width = 320;
    const height = 120;
    const paddingX = 14;
    const paddingY = 14;
    const usableWidth = width - paddingX * 2;
    const usableHeight = height - paddingY * 2;

    const points = workouts.map((item, index) => {
      const x = workouts.length <= 1
        ? width / 2
        : paddingX + (index / (workouts.length - 1)) * usableWidth;
      const normalized = range <= 0 ? 0.5 : (item.value - minValue) / range;
      const y = paddingY + (1 - normalized) * usableHeight;
      return { ...item, x, y };
    });

    const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');

    return {
      points,
      polyline,
      width,
      height,
      maxValue,
    };
  }, [historyByWorkout, summaryChartMetric]);

  useEffect(() => {
    const points = summaryChartData.points;
    if (!points.length) {
      setSelectedWorkoutId(null);
      return;
    }

    const hasCurrentSelection = selectedWorkoutId && points.some((point) => point.workoutId === selectedWorkoutId);
    if (hasCurrentSelection) return;

    const latestPoint = points[points.length - 1];
    setSelectedWorkoutId(latestPoint.workoutId);
  }, [summaryChartData.points, selectedWorkoutId]);
  const selectedPoint = useMemo(() => {
    if (!summaryChartData.points.length) return null;
    if (!selectedWorkoutId) return summaryChartData.points[summaryChartData.points.length - 1];
    return summaryChartData.points.find((point) => point.workoutId === selectedWorkoutId) || summaryChartData.points[summaryChartData.points.length - 1];
  }, [summaryChartData.points, selectedWorkoutId]);


  if (exercise === undefined) {
    return (
      <div className="min-h-screen bg-background pb-32 font-sans">
        <RouteHeader title="Exercise" onBack={() => pop()} containerClassName="max-w-md mx-auto px-4 py-3" />
        <div className="px-4 pt-4 max-w-md mx-auto">
          <div className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm text-sm text-text-muted">Loading exercise...</div>
        </div>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="min-h-screen bg-background pb-32 font-sans">
        <RouteHeader title="Exercise" onBack={() => pop()} containerClassName="max-w-md mx-auto px-4 py-3" />
        <div className="px-4 pt-4 max-w-md mx-auto">
          <div className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm text-sm text-text-muted">Exercise not found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32 font-sans">
      <RouteHeader title={exercise.name} onBack={() => pop()} containerClassName="max-w-md mx-auto px-4 py-3" />

      <div className="px-4 pt-4 max-w-md mx-auto space-y-4">

      <section>
        <div className="flex items-center gap-6 border-b border-border-subtle">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`pb-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === 'summary'
                ? 'text-text-main border-brand'
                : 'text-text-muted border-transparent'
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`pb-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === 'history'
                ? 'text-text-main border-brand'
                : 'text-text-muted border-transparent'
            }`}
          >
            History
          </button>
        </div>
      </section>

      {activeTab === 'summary' ? (
        <>
          {videoUrl ? (
            <section className="rounded-2xl overflow-hidden border border-border-subtle bg-surface shadow-sm">
              <video
                src={videoUrl}
                poster={imageUrl || undefined}
                className="w-full max-h-64 object-cover"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                disablePictureInPicture
                controlsList="nofullscreen noplaybackrate nodownload noremoteplayback"
              />
            </section>
          ) : imageUrl ? (
            <section className="rounded-2xl overflow-hidden border border-border-subtle bg-surface shadow-sm">
              <img
                src={imageUrl}
                alt={exercise.name}
                className="w-full max-h-64 object-cover"
                loading="lazy"
              />
            </section>
          ) : (
            <section className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm text-sm text-text-muted">
              No media available for this exercise.
            </section>
          )}

          <section className="rounded-2xl border border-border-subtle bg-card px-4 py-2.5 shadow-sm">
            <p className="text-xs text-text-muted">
              <span className="font-semibold text-text-main">{exercise.muscle_group || 'General'}</span>
              <span className="mx-2">•</span>
              <span className="font-semibold text-text-main">{exercise.equipment || 'None'}</span>
            </p>
          </section>

          <section className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSummaryChartMetric('heaviest')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border ${summaryChartMetric === 'heaviest' ? 'bg-brand text-white border-brand' : 'bg-surface text-text-muted border-border-subtle'}`}
              >
                Heaviest
              </button>
              <button
                type="button"
                onClick={() => setSummaryChartMetric('setVolume')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border ${summaryChartMetric === 'setVolume' ? 'bg-brand text-white border-brand' : 'bg-surface text-text-muted border-border-subtle'}`}
              >
                Set Volume
              </button>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface p-3">
              {summaryChartData.points.length ? (
                <>
                  <div className="mb-2 text-[11px] text-text-muted text-center font-semibold min-h-4">
                    {selectedPoint ? `${selectedPoint.label} • ${Math.round(selectedPoint.value)}kg` : '-'}
                  </div>
                  <svg viewBox={`0 0 ${summaryChartData.width} ${summaryChartData.height}`} className="w-full h-36">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-brand"
                      points={summaryChartData.polyline}
                    />
                    {summaryChartData.points.map((point, idx) => (
                      <g
                        key={`${point.workoutDate}-${idx}`}
                        onClick={() => setSelectedWorkoutId(point.workoutId)}
                        className="cursor-pointer"
                      >
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="10"
                          fill="transparent"
                        />
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={selectedWorkoutId === point.workoutId ? '5' : '3.5'}
                          className={selectedWorkoutId === point.workoutId ? 'fill-text-primary' : 'fill-brand'}
                        />
                      </g>
                    ))}
                  </svg>
                  <div className="mt-2 flex justify-between text-[11px] text-text-muted">
                    <span>{summaryChartData.points[0]?.label || '-'}</span>
                    <span></span>
                    <span>{summaryChartData.points[summaryChartData.points.length - 1]?.label || '-'}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-muted">No workout history yet for chart.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold uppercase text-text-muted">Personal Records</h2>
            <div className="rounded-xl border border-border-subtle bg-surface divide-y divide-border-subtle text-sm">
              <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Heaviest Weight</span>
                <span className="text-text-main font-mono font-bold">{historyData?.heaviest ? `${Math.round(historyData.heaviest.weight)}kg × ${Math.round(historyData.heaviest.reps)}` : '-'}</span>
              </div>
              <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Best Set Volume</span>
                <span className="text-text-main font-mono font-bold">{historyData?.bestSetVolume ? `${Math.round(historyData.bestSetVolume.volume)}kg` : '-'}</span>
              </div>
            </div>

            <div className="rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-muted space-y-1">
              <p>
                <span className="font-semibold">Heaviest:</span>{' '}
                {historyData?.heaviest ? `${Math.round(historyData.heaviest.weight)}kg × ${Math.round(historyData.heaviest.reps)} • ${formatDate(historyData.heaviest.workoutDate)}` : '-'}
              </p>
              <p>
                <span className="font-semibold">Best Volume Source:</span>{' '}
                {historyData?.bestSetVolume ? `${Math.round(historyData.bestSetVolume.weight)}kg × ${Math.round(historyData.bestSetVolume.reps)} • ${formatDate(historyData.bestSetVolume.workoutDate)}` : '-'}
              </p>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-border-subtle bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase text-text-muted mb-3">History</h2>
          {historyByWorkout.length ? (
            <div className="space-y-3">
              {historyByWorkout.map((group, groupIdx) => (
                <div key={`${group.workoutName}-${group.workoutDate}-${groupIdx}`} className="rounded-xl border border-border-subtle bg-surface p-3 text-sm">
                  <p className="font-semibold text-text-main truncate">{group.workoutName}</p>
                  <p className="text-xs text-text-muted mt-1">{formatDateTime(group.workoutDate)}</p>

                  <div className="mt-3 flex items-center gap-2">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={exercise.name}
                        className="h-10 w-10 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : videoUrl ? (
                      <video
                        src={videoUrl}
                        className="h-10 w-10 rounded-lg object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : null}
                    <p className="font-semibold text-text-main truncate">{exercise.name}</p>
                  </div>

                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-text-muted">Set • Weight x Reps</p>
                    <div className="mt-2 space-y-1 text-sm">
                      {group.sets.map((setRow, setIdx) => (
                        <p key={`${group.workoutDate}-${setRow.setNumber}-${setIdx}`} className="text-text-main">
                          <span className="font-semibold text-text-muted mr-2">{setRow.setNumber}</span>
                          <span className="font-medium">{Math.round(setRow.weight)}kg x {Math.round(setRow.reps)}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No completed history for this exercise yet.</p>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
