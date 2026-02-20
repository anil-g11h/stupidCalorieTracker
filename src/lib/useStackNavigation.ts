import { useNavigate, useLocation } from "react-router-dom";

export function useStackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const navigateWithTransition = (
    to: string | number, 
    direction?: 'forward' | 'backward'
  ) => {
    if (!document.startViewTransition) {
      if (typeof to === 'number') navigate(to);
      else navigate(to);
      return;
    }

    // If no direction is provided, we assume 'backward' for numbers (back button)
    // and 'forward' for strings (new pages)
    const finalDir = direction || (typeof to === 'number' ? 'backward' : 'forward');

    document.documentElement.classList.add(`transition-${finalDir}`);

    const transition = document.startViewTransition(() => {
      if (typeof to === 'number') navigate(to);
      else navigate(to);
    });

    transition.finished.finally(() => {
      document.documentElement.classList.remove(`transition-${finalDir}`);
    });
  };

  return {
    push: (to: string) => navigateWithTransition(to, 'forward'),
    pop: (to: string | number = -1) => navigateWithTransition(to, 'backward'),
    // New: for the BottomNav logic
    goToTab: (to: string, dir: 'forward' | 'backward') => navigateWithTransition(to, dir)
  };
}