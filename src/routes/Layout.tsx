import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import BottomNav from '../lib/components/BottomNav';
import ActiveWorkoutBanner from '../lib/components/ActiveWorkoutBanner';
import { syncManager } from '../lib/sync';
import { supabase } from '../lib/supabaseClient';
// import { Router } from 'svelte-spa-router';
// import routes from './routes.ts';

function Layout({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const hideActiveWorkoutBanner =
        location.pathname === '/workouts/exercises' ||
        location.pathname === '/workouts/exercises/new';
    const bottomSafeOffset = hideActiveWorkoutBanner
        ? 'calc(5.25rem + env(safe-area-inset-bottom))'
        : 'calc(10.5rem + env(safe-area-inset-bottom))';

    useEffect(() => {
        syncManager.start();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN') {
                syncManager.sync();
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

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [location.pathname, location.search, location.hash, location.key]);

    return (
        <div>
            <main style={{ paddingBottom: bottomSafeOffset }}>
                {children}
            </main>
            {!hideActiveWorkoutBanner && <ActiveWorkoutBanner />}
            <BottomNav />
        </div>
    );
}

export default Layout;