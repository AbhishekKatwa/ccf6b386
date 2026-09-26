import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { SiteScene, webglAvailable, type SceneConfig, type ShedView, type SiteViewMode } from './SiteScene';
import type { Plot } from '@/lib/shedLayout';

export type { ShedView, SiteViewMode };

const HAS_WEBGL = webglAvailable();

export interface SiteHandle {
  /** Re-frame the camera on the plot without changing perspective or top-down mode. */
  fitView(): void;
}

interface Props extends SceneConfig {
  onSelect(id: string | null): void;
  onPatch(id: string, patch: Partial<ShedView['geo']>): void;
  className?: string;
  ref?: Ref<SiteHandle>;
}

/**
 * React wrapper around the three.js site scene.
 *
 * Props in, gestures out — nothing more. If the device has no WebGL the component draws
 * nothing and the numeric inspector in the screen is the editor by itself.
 */
export function SiteCanvas({ onSelect, onPatch, className, ref, ...config }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SiteScene | null>(null);
  const cb = useRef({ onSelect, onPatch });
  cb.current = { onSelect, onPatch };

  useEffect(() => {
    if (!HAS_WEBGL || !host.current) return;
    // Built once; every later change arrives through sync().
    const s = new SiteScene(host.current, {
      onSelect: id => cb.current.onSelect(id),
      onPatch: (id, patch) => cb.current.onPatch(id, patch),
    }, config as SceneConfig);
    scene.current = s;
    return () => { scene.current = null; s.dispose(); };
  }, []);

  const cfg = useMemo<SceneConfig>(() => ({
    plot: config.plot as Plot,
    sheds: config.sheds,
    selectedId: config.selectedId,
    snap: config.snap,
    view: config.view,
    reduced: config.reduced,
  }), [config.plot, config.sheds, config.selectedId, config.snap, config.view, config.reduced]);

  useEffect(() => { scene.current?.sync(cfg); }, [cfg]);

  useImperativeHandle(ref, () => ({ fitView: () => scene.current?.resetView() }), []);

  if (!HAS_WEBGL) {
    return (
      <div className={`${className ?? ''} flex flex-col items-center justify-center gap-1 px-6 text-center`} role="status">
        <p className="font-display text-[15px] font-semibold text-ink">Numeric placement</p>
        <p className="text-[12.5px] text-muted leading-snug max-w-[300px]">
          This device cannot draw the 3D site view. The Length, Width, Height, X, Y and Angle fields
          still place every shed.
        </p>
      </div>
    );
  }
  return <div ref={host} className={className} role="img" aria-label="3D farm shed layout" />;
}
