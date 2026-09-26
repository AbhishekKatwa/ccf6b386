import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Form';
import { EmptyState, Skeleton } from './Card';

const CHUNK_FAILURE = /dynamically imported module|importing a module script failed|loading chunk|failed to fetch/i;

/** A module that never arrived is a download problem, not a broken screen — and the way out of
 *  a download problem is to download it again, which is what "Try again" does here. */
function isChunkFailure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return CHUNK_FAILURE.test(message);
}

function Recovery({ fullPage, technical, onRetry }: {
  fullPage: boolean; technical: boolean; onRetry: () => void;
}) {
  // Nothing about the failure is printed for the user: no message, no stack, no field names.
  // The console keeps the detail for whoever is looking (see componentDidCatch).
  const description = technical
    ? 'This part of the app lives in a file that could not be downloaded. Reconnect and try again — anything you had not yet synced is still on this device.'
    : 'This screen could not be drawn. Your data is unchanged, and the rest of the app is still available.';

  return (
    <div className={clsx('px-4', fullPage ? 'min-h-screen flex items-center justify-center bg-canvas' : 'py-8')}>
      <div className="w-full max-w-[420px]">
        <EmptyState
          icon={technical ? <WifiOff size={19} /> : <AlertTriangle size={19} />}
          title={technical ? 'This screen could not load' : 'Something went wrong'}
          description={description}
          action={
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="primary" size="lg" icon={<RefreshCw size={15} />} onClick={onRetry}>Try again</Button>
              <Button variant="outline" size="lg" icon={<Home size={15} />}
                onClick={() => { window.location.assign('/'); }}>
                Go to dashboard
              </Button>
            </div>
          }
        />
        <p className="mt-3 text-center text-[11px] text-muted-2">
          Still stuck? <button onClick={() => window.location.reload()} className="underline underline-offset-2 press">Reload the app</button>
        </p>
      </div>
    </div>
  );
}

interface BoundaryProps { children: ReactNode;
  /** `app` replaces the whole window; `screen` leaves the shell and navigation standing. */
  scope?: 'app' | 'screen';
  /** Changing any of these clears a caught error, so navigating away always recovers. */
  resetKeys?: readonly unknown[];
}

/**
 * Stops a render error in one module from blanking the application. The router chrome stays
 * mounted above it, so a person can always navigate out of a broken screen.
 */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Detail for the console only — the screen shows a recovery card, never a stack trace.
    console.error(`[amrut:${this.props.scope ?? 'screen'}] render failed`, error, info.componentStack);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (!this.state.error) return;
    if (!sameKeys(prev.resetKeys, this.props.resetKeys)) this.setState({ error: null });
  }

  private retry = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Recovery
        fullPage={this.props.scope === 'app'}
        technical={isChunkFailure(this.state.error)}
        onRetry={this.retry}
      />
    );
  }
}

function sameKeys(a?: readonly unknown[], b?: readonly unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

/** What a lazy screen shows while its file is in flight: the shape of a page, never a spinner
 *  that can appear to wait forever. */
export function ScreenFallback() {
  return (
    <div className="space-y-4 py-5 sm:py-7" role="status" aria-live="polite">
      <span className="sr-only">Loading this screen…</span>
      <Skeleton className="h-8 w-44" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Skeleton className="h-[86px]" />
        <Skeleton className="h-[86px]" />
        <Skeleton className="h-[86px]" />
        <Skeleton className="h-[86px]" />
      </div>
      <Skeleton className="h-[220px] rounded-[18px]" />
      <Skeleton className="h-[140px] rounded-[18px]" />
    </div>
  );
}
