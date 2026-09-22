import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, FlaskConical, History, Plus, Trash2 } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card';
import { Button, Field, IconButton, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import {
  FORMULA_TOLERANCE_KG, FORMULA_TONNE_KG, formulaPct, formulaTotalError, formulaTotalKg, formulaUsage,
} from '@/lib/calc';
import { fmtDate, fmtIN, todayISO } from '@/lib/format';
import { FEED_INGREDIENTS, type FeedFormulaItem, type FormulaInput } from '@/types';

type DraftRow = { ingredient: string; kgPerTonne: string; costPerKg: string };

const toRow = (i: FeedFormulaItem): DraftRow => ({
  ingredient: i.ingredient,
  kgPerTonne: String(i.kgPerTonne),
  costPerKg: i.costPerKg == null ? '' : String(i.costPerKg),
});

export function FormulaEditorScreen() {
  const { formulaId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { sheds, batches, feedFormulas, feed } = data;
  const createFeedFormula = useApp(s => s.createFeedFormula);
  const reviseFeedFormula = useApp(s => s.reviseFeedFormula);
  const canManageFormula = useApp(s => s.canManageFormula);
  const formulaHasConsumption = useApp(s => s.formulaHasConsumption);
  const pushToast = useApp(s => s.pushToast);
  const canFinance = useCan('viewFinance');

  const editing = feedFormulas.find(f => f.id === formulaId) ?? null;
  const initialShed = editing?.shedId ?? params.get('shedId') ?? sheds[0]?.id ?? '';
  // A revision that appends a version applies from today; an in-place fix keeps its date.
  const wasUsed = editing ? formulaHasConsumption(editing.id) : false;

  const [name, setName] = useState(editing?.name ?? '');
  const [shedId, setShedId] = useState(initialShed);
  const [effectiveFrom, setEffectiveFrom] = useState(editing && !wasUsed ? editing.effectiveFrom : todayISO());
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<DraftRow[]>(editing ? editing.items.map(toRow) : [{ ingredient: 'Maize', kgPerTonne: '', costPerKg: '' }]);
  const [pick, setPick] = useState('');
  const [confirm, setConfirm] = useState(false);

  const used = wasUsed;
  const family = feedFormulas.filter(f => f.familyId === editing?.familyId);
  const nextVersion = editing ? (used ? Math.max(...family.map(f => f.version)) + 1 : editing.version) : 1;
  const consumptionCount = useMemo(() => (
    editing ? formulaUsage(editing, feed, feedFormulas).length : 0
  ), [editing, feed, feedFormulas]);

  const numeric = rows.map(r => ({ kgPerTonne: parseFloat(r.kgPerTonne) || 0 }));
  const total = formulaTotalKg(numeric);
  const totalError = formulaTotalError(total);
  const withinTolerance = Math.abs(total - FORMULA_TONNE_KG) <= FORMULA_TOLERANCE_KG;

  const known = new Set(rows.map(r => r.ingredient.toLowerCase()));
  const suggestions = FEED_INGREDIENTS
    .filter(i => !known.has(i.toLowerCase()) && i.toLowerCase().includes(pick.trim().toLowerCase()))
    .slice(0, 8);
  const exactMatch = FEED_INGREDIENTS.some(i => i.toLowerCase() === pick.trim().toLowerCase());

  const builtItems = (): FeedFormulaItem[] => rows
    .map(r => ({
      ingredient: r.ingredient.trim(),
      kgPerTonne: parseFloat(r.kgPerTonne) || 0,
      costPerKg: r.costPerKg.trim() === '' ? undefined : parseFloat(r.costPerKg) || 0,
    }))
    .filter(i => i.ingredient && i.kgPerTonne > 0);

  function validate(): string | null {
    if (!name.trim()) return 'Formula name is required';
    if (!shedId) return 'Select a shed';
    if (builtItems().length === 0) return 'Add at least one ingredient with a quantity';
    if (totalError) return totalError;
    return null;
  }

  function submit() {
    const input: FormulaInput = {
      shedId, name: name.trim(), items: builtItems(),
      effectiveFrom, changeReason: reason.trim() || undefined,
    };
    const r = editing ? reviseFeedFormula(editing.id, input) : createFeedFormula(input);
    if (!r.ok || !r.id) return pushToast('error', r.error ?? 'Could not save formula');
    pushToast('success', used && r.version && r.version > (editing?.version ?? 0)
      ? `Saved as V${r.version} · earlier consumption still uses V${editing?.version}`
      : 'Formula saved');
    nav(`/feed/formulas/${r.id}`, { replace: true });
  }

  function addIngredient(ingredient: string) {
    setRows(v => [...v, { ingredient, kgPerTonne: '', costPerKg: '' }]);
    setPick('');
  }

  function move(idx: number, dir: -1 | 1) {
    setRows(v => {
      const to = idx + dir;
      if (to < 0 || to >= v.length) return v;
      const copy = [...v];
      [copy[idx], copy[to]] = [copy[to], copy[idx]];
      return copy;
    });
  }

  if (!editing && sheds.length === 0) {
    return (
      <Page>
        <Header title="New formula" backTo="/feed/formulas" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<FlaskConical size={22} />} title="No sheds yet" description="Create a shed first — every formula belongs to one shed." />
        </div>
      </Page>
    );
  }

  const shed = sheds.find(s => s.id === shedId);
  const live = batches.find(b => b.shedId === shedId && b.status === 'ACTIVE');

  return (
    <Page>
      <Header
        title={editing ? `Edit ${editing.name}` : 'New formula'}
        subtitle={shed ? `${shed.name}${live ? ` · ${live.code}` : ''}` : undefined}
        backTo={editing ? `/feed/formulas/${editing.id}` : '/feed/formulas'}
        action={editing ? (
          <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => nav(`/feed/formulas/${editing.id}/history`)}>History</Button>
        ) : undefined}
      />

      <div className="px-4 sm:px-0 mt-3 space-y-4 pb-6">
        {!canManageFormula(shedId) && (
          <Card>
            <p className="text-[13px] text-danger font-semibold">You cannot manage formulas for this shed</p>
            <p className="text-[12px] text-muted mt-1">Saving will be rejected. Ask the Owner for a shed assignment if you need edit rights.</p>
          </Card>
        )}

        <div className="rounded-[22px] bg-brand-soft p-4">
          <p className="text-sm text-brand-ink leading-relaxed">
            <strong>One tonne = {fmtIN(FORMULA_TONNE_KG)} kg.</strong> Enter each ingredient as KG per tonne of finished mix.
            The total must reach {fmtIN(FORMULA_TONNE_KG)} kg (±{FORMULA_TOLERANCE_KG} kg) before you can save.
          </p>
        </div>

        {used && (
          <Card>
            <p className="text-[13px] font-semibold text-ink">This version already fed {consumptionCount} {consumptionCount === 1 ? 'entry' : 'entries'}</p>
            <p className="text-[12px] text-muted mt-1 leading-relaxed">
              Saving creates <strong>V{nextVersion}</strong> for feed given from {fmtDate(effectiveFrom)}. V{editing?.version} and its
              consumption records stay untouched, so older days still report the mix they were fed with.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Formula name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Layer Peak Mix" />
          <SelectField
            label="Shed" value={shedId} onChange={e => setShedId(e.target.value)} disabled={!!editing}
            options={sheds.map(s => ({ value: s.id, label: s.name }))}
            error={editing ? undefined : (shedId ? undefined : 'Create a shed first')}
          />
        </div>

        <div>
          <SectionTitle right={<span className={withinTolerance ? 'font-mono text-[12px] text-success' : 'font-mono text-[12px] text-danger'}>{fmtIN(total, 2)} / {fmtIN(FORMULA_TONNE_KG)} kg</span>}>
            Ingredients · {rows.length}
          </SectionTitle>
          {totalError && (
            <p className="text-[12px] text-danger font-semibold px-3 py-2 rounded-[12px] bg-danger-soft">
              {totalError}. Add or adjust {Math.abs(Math.round((FORMULA_TONNE_KG - total) * 100) / 100)} kg to complete the tonne.
            </p>
          )}
          <div className="space-y-2 mt-2">
            {rows.map((r, idx) => {
              const kg = parseFloat(r.kgPerTonne) || 0;
              return (
                <div key={idx} className="rounded-[14px] border border-line bg-card p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SelectField
                        value={r.ingredient}
                        onChange={e => setRows(v => v.map((x, i) => i === idx ? { ...x, ingredient: e.target.value } : x))}
                        options={[...FEED_INGREDIENTS, r.ingredient].filter((v, i, a) => a.indexOf(v) === i).map(i => ({ value: i, label: i }))}
                      />
                    </div>
                    <IconButton label="Move up" onClick={() => move(idx, -1)} className={idx === 0 ? 'opacity-40' : ''}><ArrowUp size={14} /></IconButton>
                    <IconButton label="Move down" onClick={() => move(idx, 1)} className={idx === rows.length - 1 ? 'opacity-40' : ''}><ArrowDown size={14} /></IconButton>
                    <IconButton label="Remove ingredient" tone="danger" onClick={() => setRows(v => v.filter((_, i) => i !== idx))}><Trash2 size={14} /></IconButton>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <Field
                        label="Kg / tonne" type="number" inputMode="decimal" step="0.1" min="0" value={r.kgPerTonne}
                        onChange={e => setRows(v => v.map((x, i) => i === idx ? { ...x, kgPerTonne: e.target.value } : x))}
                        placeholder="550" suffix="kg" className="font-mono text-[18px] py-3"
                        hint={`${formulaPct(kg).toFixed(1)}% of the mix`}
                      />
                    </div>
                    {canFinance && (
                      <div className="w-28">
                        <Field label="Rate" type="number" inputMode="decimal" step="0.1" min="0" value={r.costPerKg}
                          onChange={e => setRows(v => v.map((x, i) => i === idx ? { ...x, costPerKg: e.target.value } : x))}
                          placeholder="₹/kg" className="font-mono" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Card>
          <SectionTitle>Add ingredient</SectionTitle>
          <SearchField value={pick} onChange={setPick} placeholder="Search maize, soya, stone…" />
          <div className="flex flex-wrap gap-2 mt-3">
            {suggestions.map(i => (
              <button key={i} onClick={() => addIngredient(i)}
                className="px-3 py-2 rounded-full bg-sunk text-[12px] font-semibold text-ink press hover:bg-brand-soft hover:text-brand flex items-center gap-1">
                <Plus size={12} />{i}
              </button>
            ))}
            {pick.trim() && !exactMatch && (
              <button onClick={() => addIngredient(pick.trim())}
                className="px-3 py-2 rounded-full bg-brand text-white text-[12px] font-semibold press">
                Add “{pick.trim()}”
              </button>
            )}
            {suggestions.length === 0 && !pick.trim() && (
              <p className="text-[12px] text-muted">Every catalogued ingredient is already in this mix.</p>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Effective from" type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} hint="New consumption from this date uses the mix" />
          <Field label="Change reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional — shown in history" />
        </div>

        <div className="flex gap-2">
          <Button block variant="outline" size="lg" onClick={() => nav(editing ? `/feed/formulas/${editing.id}` : '/feed/formulas')}>Cancel</Button>
          <Button block size="lg" variant="accent" disabled={!canManageFormula(shedId)}
            onClick={() => { const err = validate(); if (err) return pushToast('error', err); setConfirm(true); }}>
            {editing ? (used ? `Save as V${nextVersion}` : 'Save changes') : 'Create formula'}
          </Button>
        </div>
      </div>

      <Dialog open={confirm} onClose={() => setConfirm(false)}
        title={used ? 'Save as new version' : 'Confirm formula'}
        subtitle="Check the mix before it drives godown deduction"
        footer={
          <div className="flex gap-2">
            <Button block variant="outline" onClick={() => setConfirm(false)}>Cancel without changes</Button>
            <Button block onClick={submit}>{used ? `Save as V${nextVersion}` : 'Save formula'}</Button>
          </div>
        }>
        <div className="space-y-1.5 text-[13px]">
          {[
            ['Total Formula', `${fmtIN(total, 2)} kg`],
            ['Ingredients', String(builtItems().length)],
            ['Version', `V${nextVersion}${editing ? (used ? ' (new)' : ' (in place)') : ''}`],
            ['Effective From', fmtDate(effectiveFrom)],
            ['Shed', shed?.name ?? '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-1.5 border-b border-line-2 last:border-0">
              <span className="text-muted">{k}</span>
              <span className="font-semibold text-ink tnum">{v}</span>
            </div>
          ))}
          {reason.trim() && (
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-muted">Change reason</span>
              <span className="font-semibold text-ink text-right">{reason.trim()}</span>
            </div>
          )}
          {used && (
            <p className="text-[12px] text-muted pt-2 leading-relaxed">
              V{editing?.version} remains attached to {consumptionCount} past consumption {consumptionCount === 1 ? 'record' : 'records'}.
            </p>
          )}
        </div>
      </Dialog>
    </Page>
  );
}
