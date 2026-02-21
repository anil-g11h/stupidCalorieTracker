import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // Assuming React Router
import { db } from '../../../lib/db';
import { ESSENTIAL_AMINO_ACIDS } from '../../../lib/constants';
import { generateId } from '../../../lib';
import { useStackNavigation } from '../../../lib/useStackNavigation';
import { GoogleGenerativeAI } from "@google/generative-ai";



const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
const geminiModel = 'gemini-2.5-flash';

const ESSENTIAL_VITAMIN_KEYS = [
  'Vitamin A',
  'Vitamin C',
  'Vitamin D',
  'Vitamin E',
  'Vitamin B12',
  'Vitamin B6',
  'Folate (B9)'
] as const;

const ESSENTIAL_MINERAL_KEYS = [
  'Calcium',
  'Magnesium',
  'Potassium',
  'Zinc',
  'Iron',
  'Sodium',
  'Iodine'
] as const;

const ESSENTIAL_VITAMIN_UNITS: Record<(typeof ESSENTIAL_VITAMIN_KEYS)[number], string> = {
  'Vitamin A': 'mcg',
  'Vitamin C': 'mg',
  'Vitamin D': 'mcg',
  'Vitamin E': 'mg',
  'Vitamin B12': 'mcg',
  'Vitamin B6': 'mg',
  'Folate (B9)': 'mcg'
};

const ESSENTIAL_MINERAL_UNITS: Record<(typeof ESSENTIAL_MINERAL_KEYS)[number], string> = {
  Calcium: 'mg',
  Magnesium: 'mg',
  Potassium: 'mg',
  Zinc: 'mg',
  Iron: 'mg',
  Sodium: 'mg',
  Iodine: 'mcg'
};

const REQUIRED_MICRO_KEYS = [
  ...ESSENTIAL_AMINO_ACIDS,
  ...ESSENTIAL_VITAMIN_KEYS,
  ...ESSENTIAL_MINERAL_KEYS
] as const;

const EXACT_MICROS_KEYS_TEXT = [
  'Histidine, Isoleucine, Leucine, Lysine, Methionine, Phenylalanine, Threonine, Tryptophan, Valine,',
  'Vitamin A, Vitamin C, Vitamin D, Vitamin E, Vitamin B12, Vitamin B6, Folate (B9),',
  'Calcium, Magnesium, Potassium, Zinc, Iron, Sodium, Iodine.'
].join('\n');

const MICROS_UNIT_CONTRACT_TEXT = [
  '- Amino acids: grams (g)',
  '- Vitamin A, Vitamin D, Vitamin B12, Folate (B9), Iodine: micrograms (mcg)',
  '- Vitamin C, Vitamin E, Vitamin B6, Calcium, Magnesium, Potassium, Zinc, Iron, Sodium: milligrams (mg)'
].join('\n');

const KEY_ALIASES: Record<string, string[]> = {
  'Vitamin A': ['Vitamin A', 'vitamin_a', 'retinol', 'vitamin a rae'],
  'Vitamin C': ['Vitamin C', 'vitamin_c', 'ascorbic acid'],
  'Vitamin D': ['Vitamin D', 'vitamin_d', 'vitamin d3', 'cholecalciferol'],
  'Vitamin E': ['Vitamin E', 'vitamin_e', 'alpha tocopherol', 'tocopherol'],
  'Vitamin B12': ['Vitamin B12', 'vitamin_b12', 'b12', 'cobalamin'],
  'Vitamin B6': ['Vitamin B6', 'vitamin_b6', 'b6', 'pyridoxine'],
  'Folate (B9)': ['Folate (B9)', 'folate', 'vitamin_b9', 'folic acid', 'b9'],
  Calcium: ['Calcium'],
  Magnesium: ['Magnesium'],
  Potassium: ['Potassium'],
  Zinc: ['Zinc'],
  Iron: ['Iron'],
  Sodium: ['Sodium', 'Na'],
  Iodine: ['Iodine']
};

const normalizeMicroKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(mg|mcg|g|iu)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toNumericValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const direct = Number(value);
    if (Number.isFinite(direct)) return direct;

    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const getMicroValue = (source: Record<string, unknown>, key: string): number => {
  const normalizedEntries = Object.entries(source).reduce<Record<string, unknown>>((acc, [rawKey, rawValue]) => {
    acc[normalizeMicroKey(rawKey)] = rawValue;
    return acc;
  }, {});

  const candidates = KEY_ALIASES[key] ?? [key];
  for (const candidate of candidates) {
    const value = normalizedEntries[normalizeMicroKey(candidate)];
    const numericValue = toNumericValue(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }

  return 0;
};

const parseAiJsonFromText = (rawValue: string): Record<string, any> | null => {
  const jsonMatch = rawValue.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const candidate = jsonMatch[0];

  try {
    return JSON.parse(candidate);
  } catch {
    try {
      const repaired = candidate
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
};


const CreateFood: React.FC = () => {
  const navigate = useNavigate();

  const {pop} = useStackNavigation();
  // --- State ---
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingSize, setServingSize] = useState<number>(100);
  const [servingUnit, setServingUnit] = useState('g');
  
  const [protein, setProtein] = useState<number>(0);
  const [carbs, setCarbs] = useState<number>(0);
  const [fat, setFat] = useState<number>(0);
  const [micros, setMicros] = useState<Record<string, number>>({});
  const [aiInput, setAiInput] = useState('');
  const [showAiPasteInput, setShowAiPasteInput] = useState(false);


  const [isFetching, setIsFetching] = useState(false);

  const fetchAiData = async () => {
    if (!name) return alert("Please enter a food name first");
    if (!geminiApiKey) {
      return alert("Missing Gemini API key. Set VITE_GEMINI_API_KEY in your .env file.");
    }
    
    setIsFetching(true);
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({ 
        model: geminiModel,
        generationConfig: { responseMimeType: "application/json" }
      });

      const prompt = `Act as a clinical nutrition database. Provide the full nutritional profile for "${name}" specifically for a serving size of ${servingSize}${servingUnit}.
    Return data ONLY as raw JSON with keys: "protein", "fat", "carbs", "calories", "micros".

    EXACT_MICROS_KEYS:
    ${EXACT_MICROS_KEYS_TEXT}

    MICROS_UNIT_CONTRACT:
    ${MICROS_UNIT_CONTRACT_TEXT}

    Do not include units in keys or values.
    If any nutrient is not available, set value to 0.
    All values must be numeric (no strings, no units, no markdown, no prose, no extra keys).`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const data = JSON.parse(response.text());

      // Update State
      setProtein(data.protein || 0);
      setCarbs(data.carbs || 0);
      setFat(data.fat || 0);
      
      if (data.micros && typeof data.micros === 'object') {
        const cleanMicros: Record<string, number> = {};
        REQUIRED_MICRO_KEYS.forEach((microKey) => {
          cleanMicros[microKey] = getMicroValue(data.micros, microKey);
        });
        setMicros(cleanMicros);
      }
    } catch (err) {
      console.error("AI Fetch Error:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found') || message.includes('404')) {
        alert(`Gemini model \"${geminiModel}\" is not available for this API key/version.`);
      } else {
        alert("Failed to fetch nutrition data.");
      }
    } finally {
      setIsFetching(false);
    }
  };



  // --- Logic ---
  const calories = useMemo(() => {
    return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
  }, [protein, carbs, fat]);

  const copyAIPrompt = () => {
    const foodTarget = name || "[INSERT FOOD NAME]";
    const prompt = `Act as a clinical nutrition database. Provide the full nutritional profile for "${foodTarget}" specifically for a serving size of ${servingSize}${servingUnit}.
  Return data ONLY as raw JSON with keys: "protein", "fat", "carbs", "calories", "micros".

  EXACT_MICROS_KEYS:
  ${EXACT_MICROS_KEYS_TEXT}

  MICROS_UNIT_CONTRACT:
  ${MICROS_UNIT_CONTRACT_TEXT}

  Do not include units in keys or values.
  If any nutrient is not available, set value to 0.
  All values must be numeric (no strings, no units, no markdown, no prose, no extra keys).`;
    
    navigator.clipboard.writeText(prompt);
    alert(`Prompt for ${servingSize}${servingUnit} copied!`);
  };

  const handleAiPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    setAiInput(rawValue);

    try {
      const data = parseAiJsonFromText(rawValue);
      if (!data) return;

      if (data.protein !== undefined) setProtein(data.protein);
      if (data.carbs !== undefined) setCarbs(data.carbs);
      if (data.fat !== undefined) setFat(data.fat);
      if (data.micros && typeof data.micros === 'object') {
        const cleanMicros: Record<string, number> = {};
        REQUIRED_MICRO_KEYS.forEach((microKey) => {
          cleanMicros[microKey] = getMicroValue(data.micros, microKey);
        });

        Object.entries(data.micros).forEach(([rawKey, rawValue]) => {
          const normalized = normalizeMicroKey(rawKey);
          const mappedKey = REQUIRED_MICRO_KEYS.find(
            (microKey) =>
              normalizeMicroKey(microKey) === normalized ||
              (KEY_ALIASES[microKey] || []).some((alias) => normalizeMicroKey(alias) === normalized)
          );

          if (mappedKey) {
            cleanMicros[mappedKey] = toNumericValue(rawValue);
          }
        });

        setMicros(cleanMicros);
      }
    } catch (err) {
      console.error("Parse error", err);
    }
  };


    async function handleSubmit() {
    try {
      await db.foods.add({
        id: generateId(),
        name,
        brand: brand || undefined,
        calories,
        protein,
        carbs,
        fat,
        serving_size: servingSize,
        serving_unit: servingUnit,
        micros,
        is_recipe: false,
        created_at: new Date(),
        updated_at: new Date(),
        synced: 0
      });
      pop('/foods');
    } catch (error) {
      console.error('Failed to create food:', error);
      alert('Failed to create food');
    }
  }

  return (
<div className="container mx-auto p-4 max-w-lg bg-page">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">New Food</h1>
        <button 
          onClick={fetchAiData}
          disabled={isFetching || !name}
          className={`flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-bold transition-all ${
            isFetching ? 'bg-gray-400' : 'bg-brand text-brand-fg hover:opacity-90'
          }`}
        >
          {isFetching ? '⌛ Fetching...' : '✨ Magic Fill'}
        </button>
      </header>

      {/* Smart Import Section */}
      <div className="mb-8 p-4 bg-surface rounded-xl border border-border-subtle">
        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
          AI Data Importer
        </label>
        {!showAiPasteInput ? (
          <button
            type="button"
            onClick={() => {
              copyAIPrompt();
              setShowAiPasteInput(true);
            }}
            className="w-full p-3 text-sm font-bold border border-border-subtle rounded-lg bg-card text-text-main hover:bg-brand hover:text-brand-fg hover:border-brand transition-colors"
          >
            Copy Prompt
          </button>
        ) : (
          <textarea
            value={aiInput}
            onChange={handleAiPaste}
            placeholder="Paste AI response here to auto-fill everything..."
            className="w-full h-24 p-2 text-sm border border-border-subtle rounded-lg focus:ring-2 focus:ring-brand focus:outline-none bg-card placeholder:text-text-muted"
          />
        )}
      </div>

      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        {/* Basic Identification */}
        <div className="space-y-3">
          <input 
            placeholder="Food Name (e.g. Greek Yogurt)"
            value={name} 
            onChange={(e) => setName(e.target.value)}
            className="w-full p-3 text-lg font-semibold border-b border-border-subtle focus:border-brand outline-none transition-colors bg-transparent"
          />
          <input 
            placeholder="Brand (Optional)"
            value={brand} 
            onChange={(e) => setBrand(e.target.value)}
            className="w-full p-2 text-sm text-text-muted bg-surface rounded border-none focus:ring-1 focus:ring-brand" 
          />
        </div>

        {/* Serving Size Setup */}
        <div className="flex items-end gap-4 p-4 bg-surface rounded-xl border border-border-subtle">
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1 ml-1">Serving Size</label>
            <input 
              type="number"
              value={servingSize}
              onChange={(e) => setServingSize(parseFloat(e.target.value) || 0)}
              className="w-full p-2 border border-border-subtle rounded-lg text-center font-bold bg-card text-text-main"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1 ml-1">Unit</label>
            <select 
              value={servingUnit}
              onChange={(e) => setServingUnit(e.target.value)}
              className="w-full p-2 border border-border-subtle rounded-lg bg-card font-medium text-text-main"
            >
              <option value="g">Grams (g)</option>
              <option value="ml">Milliliters (ml)</option>
              <option value="oz">Ounces (oz)</option>
              <option value="serving">Serving</option>
            </select>
          </div>
        </div>

        {/* Macros Grid */}
        <div className="grid grid-cols-4 gap-2">
          <MacroBox label="Prot" color="text-macro-protein" val={protein} set={setProtein} />
          <MacroBox label="Carb" color="text-macro-carbs" val={carbs} set={setCarbs} />
          <MacroBox label="Fat" color="text-macro-fat" val={fat} set={setFat} />
          <div className="flex flex-col items-center justify-center bg-brand text-brand-fg rounded-xl py-2">
            <span className="text-[10px] uppercase opacity-60">Kcal</span>
            <span className="text-lg font-black">{calories}</span>
          </div>
        </div>

        {/* Detailed Micros */}
        <div className="space-y-4">
          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <span className="text-brand text-lg">🧬</span>
                <span className="font-bold text-sm text-text-main">Essential Amino Acids</span>
              </div>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_AMINO_ACIDS.map((amino) => (
                <div key={amino} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{amino}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[amino] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [amino]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-8 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">g</span>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <span className="font-bold text-sm text-text-main">Essential Vitamins</span>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_VITAMIN_KEYS.map((vitamin) => (
                <div key={vitamin} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{vitamin}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[vitamin] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [vitamin]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-10 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">{ESSENTIAL_VITAMIN_UNITS[vitamin]}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>

          <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex items-center justify-between select-none">
              <span className="font-bold text-sm text-text-main">Essential Minerals</span>
              <span className="text-text-muted group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface border-t border-border-subtle">
              {ESSENTIAL_MINERAL_KEYS.map((mineral) => (
                <div key={mineral} className="flex flex-col">
                  <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{mineral}</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      value={micros[mineral] ?? ''} 
                      onChange={(e) => setMicros(p => ({ ...p, [mineral]: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 pr-10 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                    />
                    <span className="absolute right-2 top-2 text-[10px] text-text-muted">{ESSENTIAL_MINERAL_UNITS[mineral]}</span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Link to="/foods" className="flex-1 py-3 text-center font-bold text-text-muted hover:text-text-main transition-colors">Cancel</Link>
          <button 
            onClick={handleSubmit}
            className="flex-[2] py-4 bg-brand text-brand-fg rounded-xl font-black text-lg shadow-lg hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Save Food
          </button>
        </div>
      </form>
    </div>
  );
};

// Sub-component for Macro Inputs
const MacroBox = ({ label, color, val, set }: any) => (
  <div className="flex flex-col items-center p-2 bg-card border border-border-subtle rounded-xl shadow-sm">
    <label className={`text-[10px] font-black uppercase mb-1 ${color}`}>{label}</label>
    <input 
      type="number" 
      value={val || ''} 
      onChange={(e) => set(parseFloat(e.target.value) || 0)}
      className="w-full text-center font-bold text-lg outline-none text-text-main bg-transparent"
    />
  </div>
);

export default CreateFood;