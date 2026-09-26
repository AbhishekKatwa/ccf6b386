import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, FlaskConical, History, Plus, Trash2 } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Card, EmptyState, SectionTitle } from '@/components/ui/Card';
import { Button, Field, IconButton, SearchField, SelectField } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { PageReveal } from '@/components/motion';
import { formulaCostPerTonne, formulaPct, formulaTotalKg, formulaUsage } from '@/lib/calc';
import { fmtDate, fmtIN, fmtMoney, todayISO } from '@/lib/format';
import { useGodownPrices } from '@/hooks/useGodownPrices';
import { type FeedFormulaItem, type FormulaInput } from '@/types';

type DraftRow = { ingredient: string; kgPerTonne: string };

const toRow = (i: FeedFormulaItem): DraftRow => ({
  ingredient: i.ingredient,
  kgPerTonne: String(i.kgPerTonne),
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
  const catalog = useApp(s => s.ingredientCatalog);
  const addIngredientType = useApp(s => s.addIngredientType);
  const canFinance = useCan('viewFinance');
  const { priceOf } = useGodownPrices();

  const editing = feedFormulas.find(f => f.id === formulaId) ?? null;
  const initialShed = editing?.shedId ?? params.get('shedId') ?? sheds[0]?.id ?? '';
  // A revision that appends a version applies from today; an in-place fix keeps its date.
  const wasUsed = editing ? formulaHasConsumption(editing.id) : false;

  const [name, setName] = useState(editing?.name ?? '');
  const [shedId, setShedId] = useState(initialShed);
  const [effectiveFrom, setEffectiveFrom] = useState(editing && !wasUsed ? editing.effectiveFrom : todayISO());
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<DraftRow[]>(editing ? editing.items.map(toRow) : [{ ingredient: 'Maize', kgPerTonne: '' }]);
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

  const known = new Set(rows.map(r => r.ingredient.toLowerCase()));
  const suggestions = catalog
    .filter(i => !known.has(i.toLowerCase()) && i.toLowerCase().includes(pick.trim().toLowerCase()))
    .slice(0, 8);
  const exactMatch = catalog.some(i => i.toLowerCase() === pick.trim().toLowerCase());

  const builtItems = (): FeedFormulaItem[] => rows
    .map(r => ({
      ingredient: r.ingredient.trim(),
      kgPerTonne: parseFloat(r.kgPerTonne) || 0,
    }))
    .filter(i => i.ingredient && i.kgPerTonne > 0);

  function validate(): string | null {
    if (!name.trim()) return 'Formula name is required';
    if (!shedId) return 'Select a shed';
    if (builtItems().length === 0) return 'Add at least one ingredient with a quantity';
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
    setRows(v => [...v, { ingredient, kgPerTonne: '' }]);
    setPick('');
  }

  /** A name typed into the picker joins the mix here and the global catalogue everywhere. */
  function addCustomIngredient() {
    const name = pick.trim();
    if (!name) return;
    addIngredient(name);
    addIngredientType(name);
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
  // Only sheds this user may manage, with the current one kept so a locked field still shows its name.
  const shedChoices = (() => {
    const allowed = sheds.filter(s => canManageFormula(s.id));
    const current = sheds.find(s => s.id === shedId);
    return current && !allowed.some(s => s.id === current.id) ? [current, ...allowed] : allowed;
  })();

  return (
    <Page withNav>
      <PageReveal>
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
            <strong>Enter each ingredient in KG</strong> for one tonne of the mix you make. The total is yours to decide — nothing has to add up to 1,000 kg.
            {canFinance && <> Rates are not typed here: the mix is costed at each ingredient's <strong>godown average price</strong>, so the formula cost and the shed's feed expense can never disagree.</>}
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
            label="Shed" value={shedId} onChange={e => setShedId(e.target.value)} disabled={used}
            options={shedChoices.map(s => ({ value: s.id, label: s.name }))}
            error={shedId ? undefined : 'Create a shed first'}
          />
        </div>
        <p className="-mt-2 text-[11.5px] text-muted leading-relaxed">
          {used
            ? `V${editing?.version} already fed ${consumptionCount} ${consumptionCount === 1 ? 'entry' : 'entries'}, so its shed is fixed — a copy stays on its own shed until it is fed.`
            : 'Choose the shed this mix belongs to. A copy of another formula can serve a different shed.'}
        </p>

        <div>
          <SectionTitle right={<span className="font-mono text-[12px] text-brand">
            Mix total · {fmtIN(total, 2)} kg{canFinance ? ` · ${fmtMoney(formulaCostPerTonne({ items: builtItems() }, priceOf), 2)}/tonne` : ''}
          </span>}>
            Ingredients · {rows.length}
          </SectionTitle>
          <div className="space-y-2 mt-2">
            {rows.map((r, idx) => {
              const kg = parseFloat(r.kgPerTonne) || 0;
              const rate = priceOf(r.ingredient);
              return (
                <div key={idx} className="rounded-[14px] border border-line bg-card p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <SelectField
                        value={r.ingredient}
                        onChange={e => setRows(v => v.map((x, i) => i === idx ? { ...x, ingredient: e.target.value } : x))}
                        options={[...catalog, r.ingredient].filter((v, i, a) => a.indexOf(v) === i).map(i => ({ value: i, label: i }))}
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
                        hint={formulaPct(kg, total).toFixed(1) + '% of the mix'}
                      />
                    </div>
                    {canFinance && (
                      <div className="w-28 text-right">
                        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted mb-1.5">Godown avg</p>
                        <p className="font-mono tnum text-[15px] font-semibold text-ink leading-7">
                          {rate === null ? '—' : fmtMoney(rate, 2)}
                        </p>
                        <p className="font-mono text-[9px] text-faint">₹/kg · not editable</p>
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
              <button onClick={addCustomIngredient}
                className="px-3 py-2 rounded-full bg-brand text-white text-[12px] font-semibold press">
                Add “{pick.trim()}”
              </button>
            )}
            {suggestions.length === 0 && !pick.trim() && (
              <p className="text-[12px] text-muted">Every catalogued ingredient is already in this mix.</p>
            )}
          </div>
          <p className="text-[11px] text-faint mt-2.5">A name you add here joins the global ingredient list used by the godown and every farm.</p>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Effective from" type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} hint="New consumption from this date uses the mix" />
          <Field label="Change reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional — shown in history" />
        </div>

        <div className="flex gap-2">
          <Button block variant="outline" size="lg" onClick={() => nav(editing ? `/feed/formulas/${editing.id}` : '/feed/formulas')}>Cancel</Button>
          <Button block size="lg" disabled={!canManageFormula(shedId)}
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
            ...(canFinance ? [['Cost / tonne', `${fmtMoney(formulaCostPerTonne({ items: builtItems() }, priceOf), 2)} at godown averages`]] : []),
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
      </PageReveal>
    </Page>
  );
}
