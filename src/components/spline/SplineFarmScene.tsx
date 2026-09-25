import { Component, lazy, Suspense, useCallback, useState } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import clsx from 'clsx';
import { Loader2, Box } from 'lucide-react';
import { Surface } from '@/components/ui/Card';

const LazySpline = lazy(() => import('@splinetool/react-spline').then(m => ({ default: m.default })));

const SPLINE_SCENE = 'https://prod.spline.design/8dca6daa-d77b-4c65-85a5-b220b8b66ba0/scene.splinecode';

class SplineErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.warn('Spline scene failed:', err, info.componentStack); }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

export function SplineFarmScene() {
  const [loaded, setLoaded] = useState(false);

  const onLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  return (
    <SplineErrorBoundary fallback={<SplineFallback />}>
    <Surface className="relative overflow-hidden rounded-[18px] border border-line shadow-card">
      <div className="relative w-full h-[260px] sm:h-[320px] lg:h-[360px] bg-gradient-to-b from-[#F7F8F5] to-[#EDEEF0]">
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <Loader2 size={24} className="animate-spin text-brand" />
            <p className="text-[11px] text-muted font-medium tracking-wide">Loading experience…</p>
          </div>
        )}

        <Suspense fallback={null}>
          <LazySpline
            scene={SPLINE_SCENE}
            onLoad={onLoad}
            renderOnDemand
            className={clsx('w-full h-full transition-opacity duration-700', loaded ? 'opacity-100' : 'opacity-0')}
          />
        </Suspense>
      </div>
    </Surface>
    </SplineErrorBoundary>
  );
}

export function SplineFallback() {
  return (
    <Surface className="rounded-[18px] border border-line shadow-card">
      <div className="flex items-center justify-center h-[180px] sm:h-[220px] bg-gradient-to-b from-[#F7F8F5] to-[#EDEEF0]">
        <div className="flex flex-col items-center gap-2 text-muted">
          <Box size={28} strokeWidth={1.2} className="text-brand/40" />
          <p className="text-[11px] font-medium tracking-wide">3D experience unavailable</p>
        </div>
      </div>
    </Surface>
  );
}
