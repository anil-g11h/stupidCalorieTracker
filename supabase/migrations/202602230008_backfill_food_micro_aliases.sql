begin;

update public.foods f
set micros =
  coalesce(f.micros, '{}'::jsonb)
  || jsonb_build_object(
    'Histidine', coalesce((f.micros ->> 'Histidine')::numeric, (f.micros ->> 'histidine')::numeric, 0::numeric),
    'Isoleucine', coalesce((f.micros ->> 'Isoleucine')::numeric, (f.micros ->> 'isoleucine')::numeric, 0::numeric),
    'Leucine', coalesce((f.micros ->> 'Leucine')::numeric, (f.micros ->> 'leucine')::numeric, 0::numeric),
    'Lysine', coalesce((f.micros ->> 'Lysine')::numeric, (f.micros ->> 'lysine')::numeric, 0::numeric),
    'Methionine', coalesce((f.micros ->> 'Methionine')::numeric, (f.micros ->> 'methionine')::numeric, 0::numeric),
    'Phenylalanine', coalesce((f.micros ->> 'Phenylalanine')::numeric, (f.micros ->> 'phenylalanine')::numeric, 0::numeric),
    'Threonine', coalesce((f.micros ->> 'Threonine')::numeric, (f.micros ->> 'threonine')::numeric, 0::numeric),
    'Tryptophan', coalesce((f.micros ->> 'Tryptophan')::numeric, (f.micros ->> 'tryptophan')::numeric, 0::numeric),
    'Valine', coalesce((f.micros ->> 'Valine')::numeric, (f.micros ->> 'valine')::numeric, 0::numeric),

    'Vitamin A', coalesce((f.micros ->> 'Vitamin A')::numeric, (f.micros ->> 'vitamin_a')::numeric, 0::numeric),
    'Vitamin C', coalesce((f.micros ->> 'Vitamin C')::numeric, (f.micros ->> 'vitamin_c')::numeric, 0::numeric),
    'Vitamin D', coalesce((f.micros ->> 'Vitamin D')::numeric, (f.micros ->> 'vitamin_d')::numeric, 0::numeric),
    'Vitamin E', coalesce((f.micros ->> 'Vitamin E')::numeric, (f.micros ->> 'vitamin_e')::numeric, 0::numeric),
    'Vitamin B12', coalesce((f.micros ->> 'Vitamin B12')::numeric, (f.micros ->> 'vitamin_b12')::numeric, 0::numeric),
    'Vitamin B6', coalesce((f.micros ->> 'Vitamin B6')::numeric, (f.micros ->> 'vitamin_b6')::numeric, 0::numeric),
    'Folate (B9)', coalesce((f.micros ->> 'Folate (B9)')::numeric, (f.micros ->> 'vitamin_b9')::numeric, (f.micros ->> 'folate_b9')::numeric, 0::numeric),

    'Calcium', coalesce((f.micros ->> 'Calcium')::numeric, (f.micros ->> 'calcium')::numeric, 0::numeric),
    'Magnesium', coalesce((f.micros ->> 'Magnesium')::numeric, (f.micros ->> 'magnesium')::numeric, 0::numeric),
    'Potassium', coalesce((f.micros ->> 'Potassium')::numeric, (f.micros ->> 'potassium')::numeric, 0::numeric),
    'Zinc', coalesce((f.micros ->> 'Zinc')::numeric, (f.micros ->> 'zinc')::numeric, 0::numeric),
    'Iron', coalesce((f.micros ->> 'Iron')::numeric, (f.micros ->> 'iron')::numeric, 0::numeric),
    'Sodium', coalesce((f.micros ->> 'Sodium')::numeric, (f.micros ->> 'sodium')::numeric, 0::numeric),
    'Iodine', coalesce((f.micros ->> 'Iodine')::numeric, (f.micros ->> 'iodine')::numeric, 0::numeric),

    'histidine', coalesce((f.micros ->> 'histidine')::numeric, (f.micros ->> 'Histidine')::numeric, 0::numeric),
    'isoleucine', coalesce((f.micros ->> 'isoleucine')::numeric, (f.micros ->> 'Isoleucine')::numeric, 0::numeric),
    'leucine', coalesce((f.micros ->> 'leucine')::numeric, (f.micros ->> 'Leucine')::numeric, 0::numeric),
    'lysine', coalesce((f.micros ->> 'lysine')::numeric, (f.micros ->> 'Lysine')::numeric, 0::numeric),
    'methionine', coalesce((f.micros ->> 'methionine')::numeric, (f.micros ->> 'Methionine')::numeric, 0::numeric),
    'phenylalanine', coalesce((f.micros ->> 'phenylalanine')::numeric, (f.micros ->> 'Phenylalanine')::numeric, 0::numeric),
    'threonine', coalesce((f.micros ->> 'threonine')::numeric, (f.micros ->> 'Threonine')::numeric, 0::numeric),
    'tryptophan', coalesce((f.micros ->> 'tryptophan')::numeric, (f.micros ->> 'Tryptophan')::numeric, 0::numeric),
    'valine', coalesce((f.micros ->> 'valine')::numeric, (f.micros ->> 'Valine')::numeric, 0::numeric),

    'vitamin_a', coalesce((f.micros ->> 'vitamin_a')::numeric, (f.micros ->> 'Vitamin A')::numeric, 0::numeric),
    'vitamin_c', coalesce((f.micros ->> 'vitamin_c')::numeric, (f.micros ->> 'Vitamin C')::numeric, 0::numeric),
    'vitamin_d', coalesce((f.micros ->> 'vitamin_d')::numeric, (f.micros ->> 'Vitamin D')::numeric, 0::numeric),
    'vitamin_e', coalesce((f.micros ->> 'vitamin_e')::numeric, (f.micros ->> 'Vitamin E')::numeric, 0::numeric),
    'vitamin_b12', coalesce((f.micros ->> 'vitamin_b12')::numeric, (f.micros ->> 'Vitamin B12')::numeric, 0::numeric),
    'vitamin_b6', coalesce((f.micros ->> 'vitamin_b6')::numeric, (f.micros ->> 'Vitamin B6')::numeric, 0::numeric),
    'vitamin_b9', coalesce((f.micros ->> 'vitamin_b9')::numeric, (f.micros ->> 'folate_b9')::numeric, (f.micros ->> 'Folate (B9)')::numeric, 0::numeric),
    'folate_b9', coalesce((f.micros ->> 'folate_b9')::numeric, (f.micros ->> 'vitamin_b9')::numeric, (f.micros ->> 'Folate (B9)')::numeric, 0::numeric),

    'calcium', coalesce((f.micros ->> 'calcium')::numeric, (f.micros ->> 'Calcium')::numeric, 0::numeric),
    'magnesium', coalesce((f.micros ->> 'magnesium')::numeric, (f.micros ->> 'Magnesium')::numeric, 0::numeric),
    'potassium', coalesce((f.micros ->> 'potassium')::numeric, (f.micros ->> 'Potassium')::numeric, 0::numeric),
    'zinc', coalesce((f.micros ->> 'zinc')::numeric, (f.micros ->> 'Zinc')::numeric, 0::numeric),
    'iron', coalesce((f.micros ->> 'iron')::numeric, (f.micros ->> 'Iron')::numeric, 0::numeric),
    'sodium', coalesce((f.micros ->> 'sodium')::numeric, (f.micros ->> 'Sodium')::numeric, 0::numeric),
    'iodine', coalesce((f.micros ->> 'iodine')::numeric, (f.micros ->> 'Iodine')::numeric, 0::numeric)
  )
where coalesce(f.micros, '{}'::jsonb) <> '{}'::jsonb;

commit;
