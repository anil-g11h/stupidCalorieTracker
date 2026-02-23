import React from 'react';
import { CaretLeftIcon } from '@phosphor-icons/react';

type RouteHeaderProps = {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  containerClassName?: string;
};

export default function RouteHeader({ title, onBack, rightAction, containerClassName = 'max-w-md mx-auto px-4 py-3' }: RouteHeaderProps) {
  return (
    <header className="bg-card shadow-sm sticky top-0 z-10 border-b border-border-subtle">
      <div className={`${containerClassName} flex items-center gap-3`}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="h-9 w-9 rounded-lg border border-border-subtle bg-surface text-text-main flex items-center justify-center"
            aria-label="Back"
          >
            <CaretLeftIcon size={18} weight="bold" />
          </button>
        ) : null}

        <h1 className="flex-1 text-xl font-extrabold text-text-main leading-tight truncate">{title}</h1>

        {rightAction ? <div className="shrink-0">{rightAction}</div> : null}
      </div>
    </header>
  );
}
