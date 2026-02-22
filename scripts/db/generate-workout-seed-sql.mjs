import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const MEDIA_MAP_PATH = path.join(ROOT, 'static', 'workouts', 'media-map.json');
const DEFAULT_OUTPUT_PATH = path.join(ROOT, 'supabase', 'seeds', 'workouts', 'seed_workout_exercises.wipe.sql');
const IMAGE_ASSETS_DIR = path.join(ROOT, 'static', 'workouts', 'images');
const VIDEO_ASSETS_DIR = path.join(ROOT, 'static', 'workouts', 'videos');

const MUSCLE_GROUP_MAP = new Map([
  ['chest', 'Chest'],
  ['back', 'Back'],
  ['thighs', 'Legs'],
  ['hips', 'Legs'],
  ['calves', 'Legs'],
  ['shoulder', 'Shoulders'],
  ['shoulders', 'Shoulders'],
  ['upper arms', 'Arms'],
  ['upper arm', 'Arms'],
  ['lower arms', 'Arms'],
  ['lower arm', 'Arms'],
  ['forearms', 'Arms'],
  ['forearm', 'Arms'],
  ['waist', 'Core'],
  ['plyometrics', 'Other'],
  ['cardio', 'Cardio'],
  ['stretching', 'Other'],
]);

const EQUIPMENT_MAP = [
  ['barbell', 'Barbell'],
  ['dumbbell', 'Dumbbell'],
  ['cable', 'Cable'],
  ['machine', 'Machine'],
  ['lever', 'Machine'],
  ['smith', 'Machine'],
  ['sled', 'Machine'],
  ['elliptical', 'Machine'],
  ['wheel', 'Bodyweight'],
  ['bodyweight', 'Bodyweight'],
  ['chin up', 'Bodyweight'],
  ['pull up', 'Bodyweight'],
  ['push up', 'Bodyweight'],
  ['dip', 'Bodyweight'],
  ['run', 'None'],
  ['walking', 'None'],
  ['stretch', 'None'],
  ['band', 'Band'],
  ['resistance band', 'Band'],
  ['kettlebell', 'Kettlebell'],
];

const parseFileStem = (videoPath) => {
  const file = videoPath.split('/').pop() || videoPath;
  return file.replace(/\.mp4$/i, '').trim();
};

const parseImageStem = (imagePath) => {
  const file = imagePath.split('/').pop() || imagePath;
  const noExt = file.replace(/\.[a-z0-9]+$/i, '');
  return noExt
    .replace(/_thumbnail_?@?3x|_thumbnail@3x|_small_thumbnail_?@?3x|_small_thumbnail@3x|_thumbnail|_small_thumbnail|-thumb$/i, '')
    .trim();
};

const extractSourceId = (videoStem) => {
  const match = videoStem.match(/^(\d+)-/);
  return match?.[1] || '';
};

const normalizeTokenText = (value) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\bfix\b/gi, '')
    .replace(/\bmale\b|\bfemale\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const titleCase = (value) =>
  value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .trim();

const inferMuscleGroup = (videoStem) => {
  const normalized = normalizeTokenText(videoStem);
  for (const [token, muscle] of MUSCLE_GROUP_MAP.entries()) {
    if (normalized.toLowerCase().includes(token)) {
      return muscle;
    }
  }
  return 'Other';
};

const inferEquipment = (exerciseName) => {
  const lower = exerciseName.toLowerCase();
  for (const [token, equipment] of EQUIPMENT_MAP) {
    if (lower.includes(token)) return equipment;
  }
  return 'None';
};

const inferExerciseName = (videoStem) => {
  const withoutPrefix = videoStem.replace(/^\d+-/, '');
  const noSuffix = withoutPrefix.replace(
    /-(chest|back|thighs|shoulders?|upper-arms|lower-arms|waist|hips|calves|plyometrics|cardio|stretching)$/i,
    ''
  );
  const noGender = noSuffix.replace(/-(male|female)$/i, '');
  const cleaned = normalizeTokenText(noGender.replace(/-/g, ' '));
  return titleCase(cleaned || 'Exercise');
};

const sqlLiteral = (value) => {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const buildAssetThumbnailBySourceId = () => {
  if (!fs.existsSync(IMAGE_ASSETS_DIR)) return new Map();

  const files = fs.readdirSync(IMAGE_ASSETS_DIR);
  const bySourceId = new Map();

  const scoreFile = (name) => {
    const lower = name.toLowerCase();
    let score = 0;
    if (lower.includes('-thumb.')) score += 50;
    if (lower.includes('thumbnail')) score += 30;
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) score += 10;
    if (!lower.includes(' copy')) score += 8;
    if (!lower.includes('(') && !lower.includes(')')) score += 6;
    if (!lower.includes(' ')) score += 4;
    return score;
  };

  for (const fileName of files) {
    const idMatch = fileName.match(/^(\d+)/);
    if (!idMatch) continue;
    const sourceId = idMatch[1];
    const current = bySourceId.get(sourceId);
    const next = { fileName, score: scoreFile(fileName) };
    if (!current || next.score > current.score) {
      bySourceId.set(sourceId, next);
    }
  }

  const result = new Map();
  for (const [sourceId, entry] of bySourceId.entries()) {
    result.set(sourceId, `workouts/images/${entry.fileName}`);
  }
  return result;
};

const buildAssetVideoBySourceId = () => {
  if (!fs.existsSync(VIDEO_ASSETS_DIR)) return new Map();

  const files = fs
    .readdirSync(VIDEO_ASSETS_DIR)
    .filter((fileName) => /\.(mp4|mov|webm|mkv)$/i.test(fileName));

  const bySourceId = new Map();
  const scoreFile = (name) => {
    const lower = name.toLowerCase();
    let score = 0;
    if (lower.endsWith('.mp4')) score += 20;
    if (!lower.includes(' copy')) score += 10;
    if (!lower.includes('(') && !lower.includes(')')) score += 8;
    if (!lower.includes(' ')) score += 6;
    return score;
  };

  for (const fileName of files) {
    const idMatch = fileName.match(/^(\d+)/);
    if (!idMatch) continue;
    const sourceId = idMatch[1];
    const current = bySourceId.get(sourceId);
    const next = { fileName, score: scoreFile(fileName) };
    if (!current || next.score > current.score) {
      bySourceId.set(sourceId, next);
    }
  }

  const result = new Map();
  for (const [sourceId, entry] of bySourceId.entries()) {
    result.set(sourceId, `workouts/videos/${entry.fileName}`);
  }
  return result;
};

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
};

const buildSeedSql = ({ valuesSql, mode }) => {
  const resetSql =
    mode === 'upsert'
      ? `-- Non-destructive mode: keep existing workout logs/routines and upsert global exercise rows\n`
      : `-- Full workout data reset (safe here because this environment can drop existing workout data)\nTRUNCATE TABLE\n  public.workout_sets,\n  public.workout_log_entries,\n  public.workout_rest_preferences,\n  public.workout_routine_sets,\n  public.workout_routine_entries,\n  public.workout_routines,\n  public.workouts,\n  public.workout_exercises_def\nCASCADE;\n`;

  const writeSql =
    mode === 'upsert'
      ? `INSERT INTO public.workout_exercises_def (\n  id,\n  user_id,\n  source_id,\n  name,\n  muscle_group,\n  equipment,\n  video_path,\n  thumbnail_path,\n  metric_type,\n  created_at,\n  updated_at\n)\nSELECT\n  gen_random_uuid(),\n  NULL,\n  source_id,\n  name,\n  muscle_group,\n  equipment,\n  video_path,\n  thumbnail_path,\n  metric_type,\n  timezone('utc'::text, now()),\n  timezone('utc'::text, now())\nFROM seed_rows\nON CONFLICT ((lower(btrim(name)))) WHERE (user_id IS NULL)\nDO UPDATE SET\n  source_id = EXCLUDED.source_id,\n  muscle_group = EXCLUDED.muscle_group,\n  equipment = EXCLUDED.equipment,\n  video_path = EXCLUDED.video_path,\n  thumbnail_path = EXCLUDED.thumbnail_path,\n  metric_type = EXCLUDED.metric_type,\n  updated_at = timezone('utc'::text, now());\n`
      : `INSERT INTO public.workout_exercises_def (\n  id,\n  user_id,\n  source_id,\n  name,\n  muscle_group,\n  equipment,\n  video_path,\n  thumbnail_path,\n  metric_type,\n  created_at,\n  updated_at\n)\nSELECT\n  gen_random_uuid(),\n  NULL,\n  source_id,\n  name,\n  muscle_group,\n  equipment,\n  video_path,\n  thumbnail_path,\n  metric_type,\n  timezone('utc'::text, now()),\n  timezone('utc'::text, now())\nFROM seed_rows;\n`;

  return `-- Generated from static/workouts/media-map.json\n-- Regenerate with: node scripts/db/generate-workout-seed-sql.mjs\n-- Mode: ${mode}\n\nBEGIN;\n\n-- Compatibility for older schemas missing media/source columns\nALTER TABLE public.workout_exercises_def\n  ADD COLUMN IF NOT EXISTS source_id text,\n  ADD COLUMN IF NOT EXISTS video_path text,\n  ADD COLUMN IF NOT EXISTS thumbnail_path text,\n  ADD COLUMN IF NOT EXISTS metric_type text DEFAULT 'weight_reps';\n\n${resetSql}\nWITH seed_rows (source_id, name, muscle_group, equipment, video_path, thumbnail_path, metric_type) AS (\nVALUES\n${valuesSql}\n)\n${writeSql}\nCOMMIT;\n`;
};

const main = () => {
  if (!fs.existsSync(MEDIA_MAP_PATH)) {
    throw new Error(`Missing media map at ${MEDIA_MAP_PATH}`);
  }

  const modeArg = getArgValue('mode');
  const mode = modeArg === 'upsert' ? 'upsert' : 'wipe';
  const outputPathArg = getArgValue('out');
  const outputPath = outputPathArg
    ? path.resolve(ROOT, outputPathArg)
    : DEFAULT_OUTPUT_PATH;

  const mediaMap = JSON.parse(fs.readFileSync(MEDIA_MAP_PATH, 'utf8'));
  const mediaEntries = Array.isArray(mediaMap.media) ? mediaMap.media : [];
  const assetThumbnailBySourceId = buildAssetThumbnailBySourceId();
  const assetVideoBySourceId = buildAssetVideoBySourceId();

  const mediaEntryBySourceId = new Map();
  for (const entry of mediaEntries) {
    if (!entry?.sourceId || !entry?.videoPath) continue;
    mediaEntryBySourceId.set(entry.sourceId, {
      sourceId: entry.sourceId,
      videoPath: entry.videoPath,
      thumbnailPath: entry.thumbnailPath || assetThumbnailBySourceId.get(entry.sourceId) || null,
    });
  }

  for (const [sourceId, videoPath] of assetVideoBySourceId.entries()) {
    if (mediaEntryBySourceId.has(sourceId)) continue;
    mediaEntryBySourceId.set(sourceId, {
      sourceId,
      videoPath,
      thumbnailPath: assetThumbnailBySourceId.get(sourceId) || null,
    });
  }

  for (const [sourceId, thumbnailPath] of assetThumbnailBySourceId.entries()) {
    if (mediaEntryBySourceId.has(sourceId)) continue;
    mediaEntryBySourceId.set(sourceId, {
      sourceId,
      videoPath: null,
      thumbnailPath,
    });
  }

  const rows = Array.from(mediaEntryBySourceId.values())
    .map((entry) => {
      const videoPath = entry.videoPath || null;
      const thumbnailPath = entry.thumbnailPath || null;

      const mediaStem = videoPath ? parseFileStem(videoPath) : thumbnailPath ? parseImageStem(thumbnailPath) : '';
      if (!mediaStem) return null;

      const sourceId = entry.sourceId || extractSourceId(mediaStem);
      const name = inferExerciseName(mediaStem);
      const muscleGroup = inferMuscleGroup(mediaStem);
      const equipment = inferEquipment(name);
      const metricType = muscleGroup === 'Cardio' ? 'distance_duration' : 'weight_reps';

      return {
        sourceId,
        name,
        muscleGroup,
        equipment,
        videoPath,
        thumbnailPath: thumbnailPath || assetThumbnailBySourceId.get(sourceId) || null,
        metricType,
      };
    })
    .filter(Boolean);

  const bestByName = new Map();
  for (const row of rows) {
    const normalizedNameKey = row.name.toLowerCase().trim();
    const existing = bestByName.get(normalizedNameKey);
    if (!existing) {
      bestByName.set(normalizedNameKey, row);
      continue;
    }

    const existingScore =
      (existing.thumbnailPath ? 10 : 0) +
      (existing.sourceId ? 2 : 0) +
      (existing.videoPath ? 1 : 0);
    const nextScore =
      (row.thumbnailPath ? 10 : 0) +
      (row.sourceId ? 2 : 0) +
      (row.videoPath ? 1 : 0);

    if (nextScore > existingScore) {
      bestByName.set(normalizedNameKey, row);
    }
  }

  const deduped = Array.from(bestByName.values());

  const valuesSql = deduped
    .map(
      (row) =>
        `  (${sqlLiteral(row.sourceId)}, ${sqlLiteral(row.name)}, ${sqlLiteral(row.muscleGroup)}, ${sqlLiteral(row.equipment)}, ${sqlLiteral(row.videoPath)}, ${sqlLiteral(row.thumbnailPath)}, ${sqlLiteral(row.metricType)})`
    )
    .join(',\n');

  const sql = buildSeedSql({ valuesSql, mode });

  fs.writeFileSync(outputPath, sql, 'utf8');
  console.log(`Wrote ${deduped.length} workout exercise seed rows (${mode} mode) to ${path.relative(ROOT, outputPath)}`);
};

main();
