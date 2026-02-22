import { useLocation } from 'react-router-dom';
import { HouseIcon, ListPlusIcon, BarbellIcon, UserIcon } from '@phosphor-icons/react';
import { useStackNavigation } from '../useStackNavigation'; // adjust path

const TAB_ORDER = ['/', '/log', '/workouts', '/profile'];

const TAB_MATCHERS: Record<string, string[]> = {
    '/': ['/'],
    '/log': ['/log', '/foods'],
    '/workouts': ['/workouts'],
    '/profile': ['/profile'],
};

const isPathMatch = (pathname: string, basePath: string) => {
    if (basePath === '/') return pathname === '/';
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
};

const resolveActiveTab = (pathname: string) =>
    TAB_ORDER.find((tabPath) => TAB_MATCHERS[tabPath].some((matchPath) => isPathMatch(pathname, matchPath))) ?? null;

export default function BottomNav() {
    const location = useLocation();
    const { goToTab } = useStackNavigation();
    const activeTab = resolveActiveTab(location.pathname);

    const handleTabClick = (newPath: string) => {
        if (location.pathname === newPath) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        const currentIndex = TAB_ORDER.indexOf(activeTab ?? location.pathname);
        const nextIndex = TAB_ORDER.indexOf(newPath);

        const direction = currentIndex === -1 ? 'backward' : (nextIndex > currentIndex ? 'forward' : 'backward');

        goToTab(newPath, direction);
    };

    const getBtnStyle = (path: string) =>
        `flex-1 flex items-center justify-center py-4 transition-colors ${activeTab === path ? 'text-blue-600' : 'text-gray-600'
        } hover:bg-gray-50 active:bg-gray-100`;

    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex items-stretch z-50"
            style={{ viewTransitionName: 'main-nav' }}>
            <button className={getBtnStyle('/')} onClick={() => handleTabClick('/')}>
                <HouseIcon size={28} weight="duotone" />
            </button>
            <button className={getBtnStyle('/log')} onClick={() => handleTabClick('/log')}>
                <ListPlusIcon size={28} weight="duotone" />
            </button>
            <button className={getBtnStyle('/workouts')} onClick={() => handleTabClick('/workouts')}>
                <BarbellIcon size={28} weight="duotone" />
            </button>
            <button className={getBtnStyle('/profile')} onClick={() => handleTabClick('/profile')}>
                <UserIcon size={28} weight="duotone" />
            </button>
        </nav>
    );
}