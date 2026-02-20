import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // Assuming React Router
import { db } from '../../../lib/db';
import { ESSENTIAL_AMINO_ACIDS } from '../../../lib/constants';
import { generateId } from '../../../lib';

const CreateFood: React.FC = () => {
  const navigate = useNavigate();

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

  // --- Logic ---
  const calories = useMemo(() => {
    return Math.round((protein * 4) + (carbs * 4) + (fat * 9));
  }, [protein, carbs, fat]);

  const copyAIPrompt = () => {
    const foodTarget = name || "[INSERT FOOD NAME]";
    const prompt = `Act as a clinical nutrition database. Provide the full nutritional profile for "${foodTarget}" specifically for a serving size of ${servingSize}${servingUnit}. 
Return the data ONLY as a raw JSON object with these keys: "protein", "fat", "carbs", "calories", and "micros" (containing these 9 essential amino acids: Histidine, Isoleucine, Leucine, Lysine, Methionine, Phenylalanine, Threonine, Tryptophan, Valine). 
All values should be numbers representing grams in that ${servingSize}${servingUnit} serving. Do not include markdown or prose.`;
    
    navigator.clipboard.writeText(prompt);
    alert(`Prompt for ${servingSize}${servingUnit} copied!`);
  };

  const handleAiPaste = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const rawValue = e.target.value;
    setAiInput(rawValue);

    try {
      const jsonMatch = rawValue.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const data = JSON.parse(jsonMatch[0]);

      if (data.protein !== undefined) setProtein(data.protein);
      if (data.carbs !== undefined) setCarbs(data.carbs);
      if (data.fat !== undefined) setFat(data.fat);
      if (data.micros) {
        const cleanMicros: Record<string, number> = {};
        ESSENTIAL_AMINO_ACIDS.forEach(amino => {
          if (data.micros[amino] !== undefined) cleanMicros[amino] = data.micros[amino];
        });
        setMicros(cleanMicros);
      }
      setAiInput(''); // Clear after successful parse
    } catch (err) {
      console.error("Parse error", err);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-lg bg-page min-h-screen pb-24 text-text-main">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-text-main">New Food</h1>
        <button 
          onClick={copyAIPrompt}
          className="flex items-center gap-1.5 text-xs bg-brand text-brand-fg px-4 py-2 rounded-lg font-bold hover:opacity-90 shadow-sm transition-all"
        >
          <span>✨</span> Copy AI Prompt
        </button>
      </header>

      {/* Smart Import Section */}
      <div className="mb-8 p-4 bg-surface rounded-xl border border-border-subtle">
        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
          AI Data Importer
        </label>
        <textarea
          value={aiInput}
          onChange={handleAiPaste}
          placeholder="Paste AI response here to auto-fill everything..."
          className="w-full h-12 p-2 text-sm border border-border-subtle rounded-lg focus:ring-2 focus:ring-brand focus:outline-none bg-card placeholder:text-text-muted"
        />
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
        <details className="group border border-border-subtle rounded-xl overflow-hidden shadow-sm">
          <summary className="p-4 bg-card cursor-pointer hover:bg-surface flex justify-between items-center select-none">
            <div className="flex items-center gap-2">
              <span className="text-brand text-lg">🧬</span>
              <span className="font-bold text-sm text-text-main">Essential Amino Acids</span>
            </div>
            <span className="group-open:rotate-180 transition-transform text-text-muted">▼</span>
          </summary>
          <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3 bg-surface">
            {ESSENTIAL_AMINO_ACIDS.map((amino) => (
              <div key={amino} className="flex flex-col">
                <label className="text-[10px] font-bold text-text-muted uppercase mb-1">{amino}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="any"
                    value={micros[amino] || ''} 
                    onChange={(e) => setMicros(p => ({ ...p, [amino]: parseFloat(e.target.value) || 0 }))}
                    className="w-full p-2 pr-6 text-sm border border-border-subtle rounded-lg focus:ring-1 focus:ring-brand outline-none bg-card text-text-main" 
                  />
                  <span className="absolute right-2 top-2 text-[10px] text-text-muted">g</span>
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Link to="/foods" className="flex-1 py-3 text-center font-bold text-text-muted hover:text-text-main transition-colors">Cancel</Link>
          <button 
            onClick={() => {/* handleSubmit logic */}}
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