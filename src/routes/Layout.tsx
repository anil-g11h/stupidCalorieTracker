import React from 'react';
import BottomNav from '../lib/components/BottomNav';
// import { Router } from 'svelte-spa-router';
// import routes from './routes.ts';

function Layout({ children }: { children: React.ReactNode }) {

    return (
        <div>
            {children}
            <BottomNav />
        </div>
    );
}

export default Layout;