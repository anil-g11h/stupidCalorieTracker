import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import BottomNav from '../lib/components/BottomNav';
import ActiveWorkoutBanner from '../lib/components/ActiveWorkoutBanner';
import { syncManager } from '../lib/sync';
import { supabase } from '../lib/supabaseClient';
// import { Router } from 'svelte-spa-router';
// import routes from './routes.ts';

function Layout({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const [showLoginSyncBanner, setShowLoginSyncBanner] = useState(false);
    const hideActiveWorkoutBanner =
        location.pathname === '/workouts/exercises' ||
        location.pathname === '/workouts/exercises/new';

    useEffect(() => {
        syncManager.start();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN') {
                setShowLoginSyncBanner(true);
                void syncManager.sync().finally(() => {
                    setTimeout(() => setShowLoginSyncBanner(false), 800);
                });
                return;
            }

            if (event === 'TOKEN_REFRESHED') {
                syncManager.sync();
            }
        });

        return () => {
            syncManager.stop();
            subscription.unsubscribe();
        };
    }, []);

    return (
        <div>
            {showLoginSyncBanner && (
                <div className="mx-4 mt-3 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs text-text-main">
                    Syncing your local data to cloud…
                </div>
            )}
            {children}
            {!hideActiveWorkoutBanner && <ActiveWorkoutBanner />}
            <BottomNav />
        </div>
    );
}

export default Layout;