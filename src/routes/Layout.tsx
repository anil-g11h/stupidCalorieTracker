import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CaretLeftIcon } from '@phosphor-icons/react';
import BottomNav from '../lib/components/BottomNav';
import ActiveWorkoutBanner from '../lib/components/ActiveWorkoutBanner';
import { syncManager } from '../lib/sync';
import { supabase } from '../lib/supabaseClient';
import { useStackNavigation } from '../lib/useStackNavigation';
// import { Router } from 'svelte-spa-router';
// import routes from './routes.ts';

function Layout({ children }: { children: React.ReactNode }) {
    const location = useLocation();
    const { pop } = useStackNavigation();
    const hideActiveWorkoutBanner =
        location.pathname === '/workouts/exercises' ||
        location.pathname === '/workouts/exercises/new';
    const bottomSafeOffset = hideActiveWorkoutBanner
        ? 'calc(5.25rem + env(safe-area-inset-bottom))'
        : 'calc(10.5rem + env(safe-area-inset-bottom))';
    const isPrimaryTabRoute = location.pathname === '/' || location.pathname === '/log' || location.pathname === '/workouts' || location.pathname === '/profile';
    const hasInPageBackButton =
        location.pathname.startsWith('/log/add') ||
        location.pathname.startsWith('/foods/new') ||
        location.pathname === '/workouts/exercises' ||
        /^\/workouts\/exercises\/[a-zA-Z0-9_-]+$/.test(location.pathname) ||
        /^\/workouts\/routines\/[a-zA-Z0-9_-]+$/.test(location.pathname) ||
        /^\/workouts\/[a-zA-Z0-9_-]+$/.test(location.pathname);
    const shouldShowBackButton = !isPrimaryTabRoute && !hasInPageBackButton;
    const topBackOffset = 'calc(0.75rem + env(safe-area-inset-top))';
    const topContentOffset = 'calc(3.5rem + env(safe-area-inset-top))';

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
    }, [location.pathname]);

    return (
        <div>
            {shouldShowBackButton ? (
                <button
                    type="button"
                    onClick={() => pop()}
                    className="fixed left-4 z-40 h-10 w-10 rounded-xl border border-border-subtle bg-card text-text-main shadow-sm flex items-center justify-center"
                    style={{ top: topBackOffset }}
                    aria-label="Back"
                >
                    <CaretLeftIcon size={18} weight="bold" />
                </button>
            ) : null}
            <main style={{ paddingTop: shouldShowBackButton ? topContentOffset : undefined, paddingBottom: bottomSafeOffset }}>
                {children}
            </main>
            {!hideActiveWorkoutBanner && <ActiveWorkoutBanner />}
            <BottomNav />
        </div>
    );
}

export default Layout;