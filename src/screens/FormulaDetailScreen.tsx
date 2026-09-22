import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Pencil, Power, History, FlaskConical } from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Header, Page } from '@/components/ui/Header';
import { Badge, Card, EmptyState, Row, Stat, StatCell, StatStrip } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { FormulaTable } from '@/components/ui/FormulaTable';
import { formulaCostPerTonne, formulaTotalKg, formulaUsage } from '@/lib/calc';
import { fmtDate, fmtIN, fmtMoney } from '@/lib/format';

export function FormulaDetailScreen() {
  const { formulaId } = useParams();
  const nav = useNavigate();
  const data = useCompanyData();
  const { feedFormulas, sheds, batches, feed, users } = data;
  const setFormulaActive = useApp(s => s.setFormulaActive);
  const duplicateFeedFormula = useApp(s => s.duplicateFeedFormula);
  const canManageFormula = useApp(s => s.canManageFormula);
  const pushToast = useApp(s => s.pushToast);
  const canFinance = useCan('viewFinance');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState('');

  const formula = feedFormulas.find(f => f.id === formulaId);
  if (!formula) {
    return (
      <Page>
        <Header title="Formula" backTo="/feed/formulas" />
        <div className="px-4 sm:px-0 mt-3">
          <EmptyState icon={<FlaskConical size={22} />} title="Formula not found" description="It belongs to another company or was removed." />
        </div>
      </Page>
    );
  }

  const shed = sheds.find(s => s.id === formula.shedId);
  const live = batches.find(b => b.shedId === formula.shedId && b.status === 'ACTIVE');
  const canManage = canManageFormula(formula.shedId);
  const isActive = formula.status === 'ACTIVE';
  const bound = formulaUsage(formula, feed, feedFormulas);
  const versions = feedFormulas.filter(f => f.familyId === formula.familyId).length;

  function toggleActive() {
    const r = setFormulaActive(formula!.id, !isActive);
    if (!r.ok) return pushToast('error', r.error ?? 'Failed');
    pushToast('success', isActive
      ? `${formula!.name} V${formula!.version} deactivated — no longer deducts stock`
      : `${formula!.name} V${formula!.version} is now the active mix for ${shed?.name ?? 'the shed'}`);
  }

  function duplicate() {
    const r = duplicateFeedFormula(formula!.id, { name: dupName });
    if (!r.ok || !r.id) return pushToast('error', r.error ?? 'Failed');
    setDupOpen(false);
    pushToast('success', 'Copy created — it stays inactive until you activate it');
    nav(`/feed/formulas/${r.id}/edit`);
  }

  return (
    <Page>
      <Header title={formula.name} subtitle={`${shed?.name ?? 'Shed'} · V${formula.version} · ${formula.effectiveFrom ? fmtDate(formula.effectiveFrom) : '—'}`}
        backTo="/feed/formulas"
        action={<Badge tone={isActive ? 'success' : 'neutral'}>{isActive ? 'Active' : 'Inactive'}</Badge>} />

      <div className="px-4 sm:px-0 mt-3 space-y-4 pb-6">
        <Card padded={false} className="overflow-hidden">
          <StatStrip>
            <StatCell><Stat label="Mix total" value={fmtIN(formulaTotalKg(formula.items), 2)} sub="kg / tonne" tone={Math.abs(formulaTotalKg(formula.items) - 1000) <= 1 ? 'success' : 'danger'} size="sm" /></StatCell>
            <StatCell><Stat label="Ingredients" value={String(formula.items.length)} tone="neutral" size="sm" /></StatCell>
            <StatCell><Stat label="Cost / tonne" value={canFinance ? fmtMoney(formulaCostPerTonne(formula)) : '₹••••'} tone="brand" size="sm" /></StatCell>
          </StatStrip>
        </Card>

        <FormulaTable formula={formula} showCosts={canFinance} />

        <Card>
          <Row label="Version" value={`V${formula.version} of ${versions}`} />
          <Row label="Status" value={isActive ? 'Active for new feed entries' : 'Kept for history'} mono={false} />
          <Row label="Effective from" value={fmtDate(formula.effectiveFrom)} />
          <Row label="Feeds" value={`${bound.length} consumption ${bound.length === 1 ? 'record' : 'records'}`} />
          <Row label="Created by" value={users.find(u => u.id === formula.createdBy)?.name ?? '—'} mono={false} />
          <Row label="Created on" value={fmtDate(formula.createdAt.slice(0, 10))} />
          {formula.changeReason && <Row label="Change reason" value={formula.changeReason} mono={false} />}
          {live ? null : <Row label="Shed batch" value="No live batch" mono={false} />}
        </Card>

        {!canManage && (
          <div className="rounded-[18px] bg-sunk px-4 py-3">
            <p className="text-[12px] text-muted leading-relaxed">
              You have view access to formulas. Editing is limited to the Owner and supervisors assigned to {shed?.name ?? 'this shed'}.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" icon={<History size={15} />} onClick={() => nav(`/feed/formulas/${formula.id}/history`)}>History</Button>
          {canManage && (
            <Button variant="outline" icon={<Copy size={15} />} onClick={() => { setDupName(`${formula.name} (copy)`); setDupOpen(true); }}>Duplicate</Button>
          )}
          {canManage && (
            <Button variant="outline" icon={<Pencil size={15} />} onClick={() => nav(`/feed/formulas/${formula.id}/edit`)}>
              {bound.length ? `Edit as V${Math.max(...feedFormulas.filter(f => f.familyId === formula.familyId).map(f => f.version)) + 1}` : 'Edit'}
            </Button>
          )}
          {canManage && (
            <Button variant={isActive ? 'danger' : 'success'} icon={<Power size={15} />} onClick={toggleActive}>
              {isActive ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>

        <Button block variant="accent" icon={<FlaskConical size={16} />} onClick={() => nav('/feed')}>View godown stock</Button>
      </div>

      <Dialog open={dupOpen} onClose={() => setDupOpen(false)} title="Duplicate formula"
        subtitle={`A copy of V${formula.version} as a new formula, inactive until you activate it`}
        footer={
          <div className="flex gap-2">
            <Button block variant="outline" onClick={() => setDupOpen(false)}>Cancel</Button>
            <Button block onClick={duplicate}>Create copy</Button>
          </div>
        }>
        <div className="space-y-3">
          <label className="block">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">New name</span>
            <input value={dupName} onChange={e => setDupName(e.target.value)}
              className="w-full bg-card border border-line rounded-[12px] px-3 py-2.5 text-[14px] text-ink outline-none focus:border-brand" />
          </label>
          <p className="text-[12px] text-muted leading-relaxed">
            The copy carries all {formula.items.length} ingredients at the same KG per tonne. Edit it, then activate it when you want it to drive deduction.
          </p>
        </div>
      </Dialog>
    </Page>
  );
}
