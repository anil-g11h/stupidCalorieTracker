import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeftIcon, FloppyDiskIcon as SaveIcon } from '@phosphor-icons/react';
import { db } from '../../../../lib/db';
import { generateId } from '../../../../lib';
import { METRIC_TYPES, type MetricType } from '../../../../lib/workouts';
import { useStackNavigation } from '../../../../lib/useStackNavigation';

// Constants moved outside component to prevent re-renders
const MUSCLE_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio', 'Other'];
const EQUIPMENT_TYPES = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'None'];

export default function NewExercise() {
    const navigate = useNavigate();

    // --- State Management ---
    const [newName, setNewName] = useState('');
    const [newMuscle, setNewMuscle] = useState('Chest');
    const [newEquipment, setNewEquipment] = useState('Barbell');
    const [newMetric, setNewMetric] = useState<MetricType>('weight_reps');

    const { pop } = useStackNavigation();
    
    // --- Handlers ---
    const handleSave = async () => {
        if (!newName.trim()) return;

        try {
            await db.workout_exercises_def.add({
                id: generateId(),
                user_id: null,
                name: newName.trim(),
                muscle_group: newMuscle,
                equipment: newEquipment,
                metric_type: newMetric,
                created_at: new Date(),
                synced: 0,
            });

            // Navigate back to the selection list
            navigate('/workouts/exercises');
        } catch (error) {
            console.error("Failed to create exercise:", error);
        }
    };

    const handleBack = () => {
        document.documentElement.classList.add('transition-backward');

        document.startViewTransition(() => {
            navigate(-1);
            document.documentElement.classList.remove('transition-backward');
        });
    };


    return (
        <div className="max-w-md mx-auto pt-8 pb-24 px-4 bg-background min-h-screen">
            {/* Added the 'transition-create-btn' class here */}
            <div className="bg-card p-6 rounded-2xl border border-border-subtle shadow-sm transition-create-btn">
                <header className="mb-6">
                    <h2 className="text-xl font-bold text-center text-text-main">Create New Exercise</h2>
                    <p className="text-xs text-text-muted text-center mt-1">
                        Define a custom exercise to track in your workouts.
                    </p>
                </header>

                <div className="space-y-4">
                    {/* Exercise Name */}
                    <div>
                        <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Exercise Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Incline DB Press"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="w-full p-3 bg-surface border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none transition-all"
                        />
                    </div>

                    {/* Muscle Group */}
                    <div>
                        <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Muscle Group</label>
                        <select
                            value={newMuscle}
                            onChange={(e) => setNewMuscle(e.target.value)}
                            className="w-full p-3 bg-surface border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
                        >
                            {MUSCLE_GROUPS.map((group) => (
                                <option key={group} value={group}>{group}</option>
                            ))}
                        </select>
                    </div>

                    {/* Equipment */}
                    <div>
                        <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Equipment</label>
                        <select
                            value={newEquipment}
                            onChange={(e) => setNewEquipment(e.target.value)}
                            className="w-full p-3 bg-surface border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
                        >
                            {EQUIPMENT_TYPES.map((eq) => (
                                <option key={eq} value={eq}>{eq}</option>
                            ))}
                        </select>
                    </div>

                    {/* Metric Type */}
                    <div>
                        <label className="block text-xs font-bold text-text-muted uppercase mb-1 ml-1">Tracking Type</label>
                        <select
                            value={newMetric}
                            onChange={(e) => setNewMetric(e.target.value as MetricType)}
                            className="w-full p-3 bg-surface border border-border-subtle rounded-xl text-text-main focus:ring-2 focus:ring-brand outline-none appearance-none cursor-pointer"
                        >
                            {Object.entries(METRIC_TYPES).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="mt-8 space-y-3">
                    <button
                        onClick={handleSave}
                        disabled={!newName.trim()}
                        className="w-full bg-brand text-white py-4 rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale disabled:pointer-events-none"
                    >
                        <SaveIcon size={20} weight="bold" />
                        Save Exercise
                    </button>

                    <button onClick={() => pop()} className="w-full py-3 text-text-muted font-medium hover:text-text-main transition-colors flex items-center justify-center gap-1">
                        <CaretLeftIcon weight="bold" />
                        Back to List
                    </button>
                </div>
            </div>
        </div>
    );
}