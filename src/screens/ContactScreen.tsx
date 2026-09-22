import { useState } from 'react';
import { Phone, Mail, MapPin, MessageCircle, HelpCircle, ChevronDown } from 'lucide-react';
import { Header, Page } from '@/components/ui/Header';
import { Card, GroupList, ListRow, IconTile } from '@/components/ui/Card';
import { Button, Field, TextArea } from '@/components/ui/Form';
import { useApp } from '@/store/app';

const FAQS = [
  { q: 'How is production percentage calculated?', a: 'Production % = (Total eggs collected ÷ Live birds) × 100. Live birds = Initial birds − cumulative mortality up to that date.' },
  { q: 'How is FCR calculated?', a: 'FCR = Total feed consumed (kg) ÷ Total live bird weight (kg). Lower FCR indicates better feed efficiency. Target: <1.8 excellent, 1.8–2.2 good, >2.2 needs attention.' },
  { q: 'What does "day lock" mean?', a: 'Once a farm day is locked, historical entries for that date cannot be edited by normal users. Only the OWNER can unlock a locked day. This protects audited data.' },
  { q: 'Why can\'t I see financial data?', a: 'Operational roles (Farm Manager, Supervisor, Employee) do not see purchase rates, selling rates, revenue, profit or margins by default. The OWNER must explicitly grant finance permission.' },
  { q: 'Does the app work offline?', a: 'Yes. All entries are cached locally and queued for sync. Unsynced records show a "Pending sync" badge. Tap Profile → Sync to push when back online.' },
  { q: 'How is tray pricing calculated?', a: 'Egg sale amount = Trays × Eggs per tray (30) × Rate per egg. This is the standard Amrut Poultry workflow.' },
];

const CONTACTS = [
  { icon: Phone, label: 'Support helpline', value: '+91 90355 26551', href: 'tel:+919035526551' },
  { icon: Mail, label: 'Email', value: 'support@amrutpoultry.in', href: 'mailto:support@amrutpoultry.in' },
  { icon: MapPin, label: 'Head office', value: 'Nashik, Maharashtra, India' },
  { icon: MessageCircle, label: 'WhatsApp', value: '+91 90355 26551', href: 'https://wa.me/919035526551' },
];

export function ContactScreen() {
  const pushToast = useApp(s => s.pushToast);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [form, setForm] = useState({ name: '', mobile: '', subject: '', message: '' });

  function submit() {
    if (!form.name.trim() || !form.message.trim()) return pushToast('error', 'Name and message required');
    pushToast('success', 'Message sent — our team will respond within 24h');
    setForm({ name: '', mobile: '', subject: '', message: '' });
  }

  return (
    <Page withNav>
      <Header title="Contact & help" subtitle="Support · FAQ" />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <div>
          <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">Reach us</p>
          <GroupList>
            {CONTACTS.map(c => {
              const Icon = c.icon;
              const row = (
                <ListRow
                  leading={<IconTile tone="brand"><Icon size={17} /></IconTile>}
                  title={<span className="text-[10px] uppercase tracking-wider text-muted font-semibold">{c.label}</span>}
                  subtitle={<span className="text-sm font-semibold text-ink">{c.value}</span>} />
              );
              return c.href
                ? <a key={c.label} href={c.href} className="block">{row}</a>
                : <div key={c.label}>{row}</div>;
            })}
          </GroupList>
        </div>

        <div id="faq">
          <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5">
            <HelpCircle size={14} className="text-brand" /> FAQ
          </p>
          <Card padded={false} className="overflow-hidden">
            <div className="divide-y divide-line-2">
              {FAQS.map((f, i) => (
                <div key={i}>
                  <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="press w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-sunk/60 transition-colors">
                    <span className="flex-1 font-display font-semibold text-sm text-ink">{f.q}</span>
                    <ChevronDown size={15} className={`text-muted transition-transform flex-shrink-0 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-4 pb-3.5 ap-fade-in">
                      <p className="text-xs text-muted leading-relaxed">{f.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <p className="font-display font-bold text-ink text-sm mb-3">Send a message</p>
          <div className="space-y-3">
            <Field label="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Field label="Mobile" type="tel" inputMode="numeric" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} className="font-mono" />
            <Field label="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="e.g. Feed formula help" />
            <TextArea label="Message" rows={4} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
            <Button block onClick={submit}>Send message</Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}
