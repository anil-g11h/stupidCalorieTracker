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

    useEffect(() => {
        syncManager.start();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
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
            {children}
            {!hideActiveWorkoutBanner && <ActiveWorkoutBanner />}
            <BottomNav />
        </div>
    );
}

export default Layout;