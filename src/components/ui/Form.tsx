import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { ChevronDown, Minus, Plus, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useReducedMotion } from '@/components/motion';

type BtnVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'success';
type BtnSize = 'sm' | 'md' | 'lg';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant; size?: BtnSize; block?: boolean; icon?: ReactNode; loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', block, icon, loading, children, className, disabled, ...rest }: BtnProps) {
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-brand text-white hover:bg-brand-2 active:bg-brand-ink shadow-card hover:shadow-float',
    success: 'bg-success text-white hover:brightness-110 active:brightness-95 shadow-card',
    danger: 'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-card',
    ghost: 'bg-transparent text-brand hover:bg-brand-soft active:bg-brand-ink/[.07]',
    outline: 'bg-card border border-line text-ink-2 hover:border-brand/50 hover:text-brand hover:bg-brand-soft/40 active:bg-brand-soft',
  };
  const sizes: Record<BtnSize, string> = {
    sm: 'px-3 py-1.5 text-[12px] rounded-[9px] gap-1.5',
    md: 'px-4 py-2.5 text-[13px] rounded-[11px] gap-2',
    lg: 'px-5 py-3.5 text-[15px] rounded-[12px] gap-2',
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-semibold transition-all press ring-focus',
        'disabled:opacity-45 disabled:cursor-not-allowed disabled:active:transform-none disabled:shadow-none',
        variants[variant], sizes[size], block && 'w-full', className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ children, label, onClick, tone = 'neutral', className }: {
  children: ReactNode; label: string; onClick?: () => void; tone?: 'neutral' | 'brand' | 'danger'; className?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      className={clsx(
        'inline-flex items-center justify-center w-9 h-9 rounded-[10px] press ring-focus shrink-0',
        tone === 'brand' ? 'bg-brand-soft text-brand' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-card border border-line text-ink-2 hover:text-brand hover:border-brand',
        className,
      )}
    >{children}</button>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Label({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">{children}</span>;
}

function Help({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <span className="block text-[12px] text-danger mt-1.5 font-medium ap-fade-in">{error}</span>;
  if (hint) return <span className="block text-[12px] text-muted mt-1.5">{hint}</span>;
  return null;
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> {
  label?: string; hint?: string; error?: string; prefix?: ReactNode; suffix?: ReactNode;
}

export function Field({ label, hint, error, prefix, suffix, className, ...rest }: FieldProps) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className={clsx(
        'flex flex-wrap items-center gap-x-2 gap-y-1 bg-card border rounded-[11px] px-3 transition-all',
        error ? 'border-danger focus-within:shadow-[0_0_0_3px_rgb(179_38_30/0.10)]' : 'border-line focus-within:border-brand focus-within:shadow-[0_0_0_3px_rgb(22_74_53/0.10)]',
      )}>
        {prefix && <span className="text-muted text-[13px] shrink-0">{prefix}</span>}
        <input
          {...rest}
          className={clsx('flex-1 min-w-[3.5rem] py-2.5 text-[14px] bg-transparent outline-none text-ink tnum placeholder:text-muted-2 placeholder:font-sans', className)}
        />
        {suffix && <span className="text-muted text-[13px] shrink-0">{suffix}</span>}
      </div>
      <Help error={error} hint={hint} />
    </label>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; error?: string; hint?: string; options: { value: string; label: string }[];
}
export function SelectField({ label, error, hint, options, className, ...rest }: SelectFieldProps) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className={clsx('relative', error ? '' : '')}>
        <select
          {...rest}
          className={clsx(
            'w-full appearance-none bg-card border rounded-[11px] pl-3 pr-9 py-2.5 text-[14px] text-ink outline-none transition-all',
            error ? 'border-danger focus:shadow-[0_0_0_3px_rgb(179_38_30/0.10)]' : 'border-line focus:border-brand focus:shadow-[0_0_0_3px_rgb(22_74_53/0.10)]',
            className,
          )}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      </div>
      <Help error={error} hint={hint} />
    </label>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string }
export function TextArea({ label, className, ...rest }: TextAreaProps) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        {...rest}
        className={clsx('w-full bg-card border border-line rounded-[11px] px-3 py-2.5 text-[14px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgb(22_74_53/0.10)] resize-none transition-all', className)}
      />
    </label>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search', className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-sunk border border-transparent rounded-full pl-9 pr-9 py-2.5 text-[14px] text-ink outline-none focus:border-brand focus:bg-card focus:shadow-[0_0_0_3px_rgb(22_74_53/0.08)] transition-all placeholder:text-muted-2"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center justify-between w-full py-2 text-left gap-4 press">
      <div className="min-w-0">
        <p className="font-semibold text-[14px] text-ink">{label}</p>
        {description && <p className="text-[12px] text-muted mt-0.5">{description}</p>}
      </div>
      <span
        className={clsx('relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ring-focus', checked ? 'bg-brand' : 'bg-line')}
        role="switch" aria-checked={checked} aria-label={label}
      >
        <span className={clsx('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function SegmentedTabs<T extends string>({ value, onChange, options, scroll = false }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[]; scroll?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <div className={clsx('relative flex gap-1 bg-sunk rounded-full p-1', scroll ? 'overflow-x-auto no-scrollbar' : '')}>
      {/* Sliding active pill */}
      <AnimatePresence>
        {!reduced && (
          <motion.span
            layoutId="segmented-active"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-1 bottom-1 rounded-full bg-card shadow-card ring-1 ring-inset ring-brand/15 pointer-events-none"
            style={{
              left: `${options.findIndex(o => o.value === value) * (100 / options.length)}%`,
              width: `${100 / options.length}%`,
            }}
            aria-hidden
          />
        )}
      </AnimatePresence>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'relative z-10 py-2 px-3.5 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 press',
            scroll ? 'flex-none' : 'flex-1',
            value === o.value ? 'text-brand' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Selectable pill group (single-select). */
export function ChipGroup<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-all press',
            value === o.value ? 'bg-brand text-white border-brand' : 'bg-card text-muted border-line hover:border-brand hover:text-brand',
          )}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** Numeric stepper for fast mobile entry. */
export function Stepper({ value, onChange, step = 1, min = 0, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 bg-card border border-line rounded-[12px] p-1">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} aria-label="Decrease"
        className="w-9 h-9 rounded-[9px] bg-sunk text-ink-2 flex items-center justify-center press hover:text-brand">
        <Minus size={15} />
      </button>
      <span className="min-w-[64px] text-center font-display text-[18px] font-semibold tnum text-ink">
        {value.toLocaleString('en-IN')}{suffix && <span className="text-[11px] text-muted font-sans ml-1">{suffix}</span>}
      </span>
      <button type="button" onClick={() => onChange(value + step)} aria-label="Increase"
        className="w-9 h-9 rounded-[9px] bg-sunk text-ink-2 flex items-center justify-center press hover:text-brand">
        <Plus size={15} />
      </button>
    </div>
  );
}
