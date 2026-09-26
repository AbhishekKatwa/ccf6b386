import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Building2, Copy, Grid3x3, Maximize2, Plus, RotateCcw, RotateCw, Save, Scan, Trash2, TriangleAlert,
} from 'lucide-react';
import { dataService } from '@/services/dataService';
import { useApp, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, IconTile, Stat, StatCell, StatStrip } from '@/components/ui/Card';
import { Button, Field, IconButton, SegmentedTabs } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { StaggerContainer, StaggerItem, useReducedMotion } from '@/components/motion';
import { SiteCanvas, type ShedView, type SiteHandle, type SiteViewMode } from '@/components/site3d/SiteCanvas';
import {
  DEFAULT_SHED, GUTTER, LIMITS, ROTATE_STEP, areaOf, clampToPlot, dimensionError, findFreeSpot, geometryOf,
  geometryPatch, layoutIssues, layoutSignature, normDeg, objectCode, plotError, plotOf, placementEqual,
  type Placement, type Plot,
} from '@/lib/shedLayout';
import { fmtIN } from '@/lib/format';

/**
 * The site planner: a 3D view of a farm's plot with one object per shed.
 *
 * Adding, duplicating and removing a shed are real record actions the moment they happen,
 * exactly as they are on the farm screen. Placement — move, resize, rotate, rename — lives in
 * this draft until Save, so an afternoon of nudging never half-writes to a shed.
 */

interface Row {
  id: string;
  name: string;
  code: string;
  capacity: number;
  geo: Placement;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A numeric inspector field that clamps to the legal range instead of rejecting the keystroke. */
function NumberField({ label, value, onCommit, min, max, suffix = 'm' }: {
  label: string; value: number; onCommit: (v: number) => void; min: number; max: number; suffix?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => { setText(String(round(value))); }, [value]);
  return (
    <Field
      label={label} value={text} type="text" inputMode="decimal" suffix={suffix}
      hint={`${min}–${max}${suffix}`} className="font-mono tnum"
      onChange={e => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
      }}
      onBlur={() => setText(String(round(value)))}
    />
  );
}

export function FarmLayoutScreen() {
  const { farmId } = useParams();
  const reduced = useReducedMotion();
  const pushToast = useApp(s => s.pushToast);
  const updateFarm = useApp(s => s.updateFarm);
  const { farms, batches } = useCompanyData();
  const canvas = useRef<SiteHandle>(null);

  const farm = useMemo(() => farms.find(f => f.id === farmId), [farms, farmId]);
  const plot = useMemo(() => plotOf(farm), [farm]);
  const allSheds = dataService.sheds.useList();
  const farmSheds = useMemo(() => allSheds.filter(s => s.farmId === farmId), [allSheds, farmId]);

  /** The plot as the record holds it — the reference the draft is compared against. */
  const source = useMemo<Row[]>(
    () => farmSheds.map((s, i) => ({
      id: s.id, name: s.name, code: objectCode(i), capacity: s.capacity, geo: geometryOf(s, i, plot),
    })),
    [farmSheds, plot],
  );

  const [rows, setRows] = useState<Row[]>(source);
  const [draftPlot, setDraftPlot] = useState<Plot>(plot);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [view, setView] = useState<SiteViewMode>('perspective');
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCap, setNewCap] = useState('');
  const [confirmGone, setConfirmGone] = useState<Row | null>(null);

  const dirty = layoutSignature(rows, draftPlot) !== layoutSignature(source, plot);

  // While the draft is clean it mirrors the store, so a late cloud hydration still reaches
  // the scene instead of being shadowed by the empty list the first render saw.
  useEffect(() => {
    if (dirty) return;
    setRows(source);
    setDraftPlot(plot);
  }, [source, plot, dirty]);

  const selectedRow = rows.find(r => r.id === selected) ?? null;
  const issues = layoutIssues(rows.map(r => r.geo), draftPlot);
  const shedViews: ShedView[] = rows.map((r, i) => ({
    id: r.id, code: r.code, name: r.name, geo: r.geo,
    conflict: issues.colliding.has(i) || issues.outside.has(i),
  }));

  const patchGeo = (id: string, patch: Partial<Placement>) => setRows(rs => rs.map(r => (
    // Rounding here keeps a save idempotent: the draft holds exactly the numbers the record
    // will hold, so a saved layout reads as clean rather than forever edited.
    r.id === id ? { ...r, geo: geometryPatch(clampToPlot({ ...r.geo, ...patch }, draftPlot)) } : r
  )));

  const place = (base: Placement, name: string, capacity: number) => {
    const geo = geometryPatch(findFreeSpot(base, rows.map(r => r.geo), draftPlot));
    const shed = dataService.sheds.create({ farmId: farmId!, name, capacity, status: 'IDLE', ...geo });
    if (!shed) {
      pushToast('error', 'No company selected');
      return;
    }
    // The scene draws the draft, and the draft only mirrors the store while it is clean, so a
    // shed made on top of unsaved edits has to enter the draft here or it would stay invisible.
    setRows(rs => [...rs, { id: shed.id, name, code: objectCode(rs.length), capacity, geo }]);
    setSelected(shed.id);
  };

  function addShed() {
    const name = newName.trim();
    const capacity = parseInt(newCap, 10);
    if (!name) return pushToast('error', 'Shed name is required');
    if (!capacity || capacity <= 0) return pushToast('error', 'Enter a valid capacity');
    place({ ...DEFAULT_SHED, layoutX: 0, layoutY: 0, rotationDeg: 0 }, name, capacity);
    setAddOpen(false);
    setNewName('');
    setNewCap('');
  }

  function duplicate() {
    if (!selectedRow) return;
    const g = selectedRow.geo;
    place(
      { ...g, layoutX: g.layoutX + Math.max(GUTTER, g.lengthM * 0.1), layoutY: g.layoutY + g.widthM + GUTTER },
      `${selectedRow.name} copy`, selectedRow.capacity,
    );
  }

  function requestDelete() {
    if (!selectedRow) return;
    if (batches.some(b => b.shedId === selectedRow.id)) {
      return pushToast('error', `${selectedRow.name} has batches on it. Move those first.`);
    }
    setConfirmGone(selectedRow);
  }

  function confirmDelete() {
    const row = confirmGone;
    setConfirmGone(null);
    if (!row) return;
    const res = dataService.sheds.remove(row.id);
    if (!res.ok) return pushToast('error', res.error ?? 'This shed could not be removed');
    setRows(rs => rs.filter(r => r.id !== row.id));
    setSelected(null);
  }

  function commit() {
    const bad = plotError(draftPlot);
    if (bad) return pushToast('error', bad);
    const dims = rows.map(r => dimensionError(r.geo)).find(Boolean);
    if (dims) return pushToast('error', dims);
    const src = new Map(source.map(r => [r.id, r] as const));
    rows.forEach(r => {
      const prev = src.get(r.id);
      if (prev && prev.name === r.name && placementEqual(prev.geo, r.geo)) return;
      dataService.sheds.update(r.id, { name: r.name.trim(), ...geometryPatch(r.geo) });
    });
    if (draftPlot.lengthM !== plot.lengthM || draftPlot.widthM !== plot.widthM) {
      updateFarm(farmId!, { plotLengthM: draftPlot.lengthM, plotWidthM: draftPlot.widthM });
    }
    pushToast('success', 'Layout saved');
  }

  function discard() {
    setRows(source);
    setDraftPlot(plot);
    setSelected(null);
  }

  function rotate(by: number) {
    if (!selectedRow) return;
    patchGeo(selectedRow.id, { rotationDeg: normDeg(selectedRow.geo.rotationDeg + by) });
  }

  if (!farm) {
    return (
      <Page withNav>
        <Header title="Farm layout" backTo="/farms" />
        <div className="px-4 sm:px-0"><EmptyState title="Farm not found" /></div>
      </Page>
    );
  }

  const covered = rows.reduce((s, r) => s + areaOf(r.geo), 0);
  const plotArea = draftPlot.lengthM * draftPlot.widthM;

  return (
    <Page withNav>
      <Header
        title="Farm layout"
        subtitle={`${farm.name} · plot ${draftPlot.lengthM} × ${draftPlot.widthM} m`}
        action={dirty
          ? <Button size="sm" icon={<Save size={14} />} onClick={commit}>Save</Button>
          : <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Shed</Button>}
      />

      <StaggerContainer className="px-4 sm:px-0 mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <StaggerItem className="min-w-0">
          <Card padded={false} className="overflow-hidden">
            <div className="relative h-[44vh] min-h-[280px] lg:h-[64vh] bg-sunk">
              <SiteCanvas
                ref={canvas}
                className="absolute inset-0"
                plot={draftPlot}
                sheds={shedViews}
                selectedId={selected}
                snap={snapOn}
                view={view}
                reduced={reduced}
                onSelect={setSelected}
                onPatch={patchGeo}
              />
              {!rows.length && (
                <div className="absolute inset-0 flex items-center justify-center px-6 pointer-events-none">
                  <div className="pointer-events-auto bg-card/92 border border-line rounded-2xl px-5 py-4 max-w-[300px] text-center">
                    <p className="font-display text-[15px] font-semibold text-ink">Nothing on this plot yet</p>
                    <p className="text-[12.5px] text-muted mt-1 leading-snug">
                      Add a shed, then drag it into place. Every square of the grid is 5 metres.
                    </p>
                    <Button size="sm" className="mt-3" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add shed</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-line-2">
              <SegmentedTabs
                value={view}
                onChange={setView}
                options={[
                  { value: 'perspective', label: 'Perspective', icon: <Box size={13} /> },
                  { value: 'top', label: 'Top', icon: <Scan size={13} /> },
                ]}
              />
              <button
                type="button"
                onClick={() => setSnapOn(v => !v)}
                aria-pressed={snapOn}
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium press ${
                  snapOn ? 'border-brand/30 bg-brand-soft text-brand' : 'border-line bg-card text-muted'
                }`}
              >
                <Grid3x3 size={13} /> Snap 5 m
              </button>
              <div className="flex-1 min-w-0" />
              <IconButton label="Frame the whole plot" onClick={() => canvas.current?.fitView()}><Maximize2 size={15} /></IconButton>
              <IconButton label="Duplicate the selected shed" onClick={duplicate} tone={selectedRow ? 'brand' : 'neutral'}><Copy size={15} /></IconButton>
              <IconButton label="Delete the selected shed" onClick={requestDelete} tone={selectedRow ? 'danger' : 'neutral'}><Trash2 size={15} /></IconButton>
              {/* Below sm the header already carries this button; the toolbar row has to hold the gizmos. */}
              <span className="hidden sm:flex"><Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Shed</Button></span>
            </div>
          </Card>

          {!!rows.length && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {rows.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelected(r.id)}
                  aria-pressed={r.id === selected}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium press tnum ${
                    r.id === selected ? 'border-brand bg-brand text-white' : 'border-line bg-card text-ink-2 hover:border-brand/40'
                  }`}
                >
                  <Building2 size={13} />
                  {r.name}
                  <span className={r.id === selected ? 'text-white/70' : 'text-muted-2'}>{r.code}</span>
                </button>
              ))}
            </div>
          )}
        </StaggerItem>

        <StaggerItem className="min-w-0">
          <div className="space-y-4">
            {selectedRow ? (
              <Card className="space-y-3.5">
                <div className="flex items-start gap-2.5">
                  <IconTile tone="brand" size={40}><Building2 size={18} /></IconTile>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">{selectedRow.code}</p>
                    <input
                      value={selectedRow.name}
                      aria-label="Shed name"
                      onChange={e => setRows(rs => rs.map(r => r.id === selectedRow.id ? { ...r, name: e.target.value } : r))}
                      className="w-full font-display text-[17px] font-semibold text-ink bg-transparent border-0 p-0 mt-0.5 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <NumberField label="Length" value={selectedRow.geo.lengthM} min={LIMITS.lengthM.min} max={LIMITS.lengthM.max}
                    onCommit={v => patchGeo(selectedRow.id, { lengthM: v })} />
                  <NumberField label="Width" value={selectedRow.geo.widthM} min={LIMITS.widthM.min} max={LIMITS.widthM.max}
                    onCommit={v => patchGeo(selectedRow.id, { widthM: v })} />
                  <NumberField label="Height" value={selectedRow.geo.heightM} min={LIMITS.heightM.min} max={LIMITS.heightM.max}
                    onCommit={v => patchGeo(selectedRow.id, { heightM: v })} />
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <NumberField label="X" value={selectedRow.geo.layoutX} min={-draftPlot.lengthM / 2} max={draftPlot.lengthM / 2}
                    onCommit={v => patchGeo(selectedRow.id, { layoutX: v })} />
                  <NumberField label="Y" value={selectedRow.geo.layoutY} min={-draftPlot.widthM / 2} max={draftPlot.widthM / 2}
                    onCommit={v => patchGeo(selectedRow.id, { layoutY: v })} />
                  <NumberField label="Angle" suffix="°" value={selectedRow.geo.rotationDeg} min={0} max={359}
                    onCommit={v => patchGeo(selectedRow.id, { rotationDeg: normDeg(v) })} />
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" icon={<RotateCcw size={14} />} onClick={() => rotate(-ROTATE_STEP)}>15°</Button>
                  <Button size="sm" variant="outline" icon={<RotateCw size={14} />} onClick={() => rotate(ROTATE_STEP)}>15°</Button>
                  <Button size="sm" variant="ghost" onClick={() => patchGeo(selectedRow.id, { rotationDeg: 0 })}>Level</Button>
                </div>

                {issues.colliding.has(rows.indexOf(selectedRow)) && (
                  <p className="flex items-start gap-2 text-[12px] text-danger leading-snug">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    This shed overlaps another one. Space them out before saving.
                  </p>
                )}

                <StatStrip className="border-t border-line-2 -mx-4 -mb-4">
                  <StatCell><Stat label="Footprint" value={`${fmtIN(Math.round(areaOf(selectedRow.geo)))} m²`} tone="brand" size="sm" /></StatCell>
                  <StatCell><Stat label="Capacity" value={fmtIN(selectedRow.capacity)} tone="neutral" size="sm" /></StatCell>
                </StatStrip>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon={<Building2 size={22} />}
                  title="No shed selected"
                  description="Tap a shed in the scene, or pick one from the row under it, to move, resize or rotate it."
                />
              </Card>
            )}

            <Card className="space-y-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Site</p>
              <div className="grid grid-cols-2 gap-2.5">
                <NumberField label="Plot length" value={draftPlot.lengthM} min={LIMITS.plotLengthM.min} max={LIMITS.plotLengthM.max}
                  onCommit={v => setDraftPlot(p => ({ ...p, lengthM: v }))} />
                <NumberField label="Plot width" value={draftPlot.widthM} min={LIMITS.plotWidthM.min} max={LIMITS.plotWidthM.max}
                  onCommit={v => setDraftPlot(p => ({ ...p, widthM: v }))} />
              </div>
              <p className="text-[12px] text-muted leading-snug">
                The working plane every shed is measured against. Sheds are held inside its boundary.
              </p>
              <StatStrip className="border-t border-line-2 -mx-4 -mb-4">
                <StatCell><Stat label="Sheds" value={fmtIN(rows.length)} tone="brand" size="sm" /></StatCell>
                <StatCell><Stat label="Covered" value={`${fmtIN(Math.round(covered))} m²`} tone="neutral" size="sm" /></StatCell>
                <StatCell><Stat label="Of plot" value={`${Math.round((covered / plotArea) * 100)}%`} tone="accent" size="sm" /></StatCell>
              </StatStrip>
            </Card>

            {dirty && (
              <div className="flex gap-2">
                <Button block variant="outline" onClick={discard}>Discard</Button>
                <Button block icon={<Save size={15} />} onClick={commit}>Save layout</Button>
              </div>
            )}

            <p className="text-[11.5px] text-muted-2 leading-snug px-1">
              Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom. Drag a shed's
              body to move it and its gold handles to resize or turn it.
            </p>
          </div>
        </StaggerItem>
      </StaggerContainer>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Place a shed"
        subtitle={farm.name}
        footer={(
          <div className="flex gap-2">
            <Button variant="outline" block onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button block onClick={addShed}>Place shed</Button>
          </div>
        )}
      >
        <div className="space-y-3">
          <Field label="Shed name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Gld-3" />
          <Field
            label="Bird capacity" type="number" inputMode="numeric" value={newCap}
            onChange={e => setNewCap(e.target.value)} placeholder="e.g. 25000" className="font-mono tnum"
          />
        </div>
        <p className="text-[11.5px] text-muted-2 mt-3 leading-snug">
          It lands on the first clear part of the plot at {DEFAULT_SHED.lengthM} × {DEFAULT_SHED.widthM} × {DEFAULT_SHED.heightM} m.
          Resizing and moving it stays a draft until you save the layout.
        </p>
      </Dialog>

      <ConfirmDialog
        open={!!confirmGone}
        title={`Remove ${confirmGone?.name ?? 'shed'}?`}
        message="This deletes the shed record and its place on the plot. A shed with batches on it cannot be removed."
        confirmLabel="Remove shed"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirmGone(null)}
      />
    </Page>
  );
}
