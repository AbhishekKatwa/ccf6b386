import { ArchiveX } from 'lucide-react';

/** §12: a closed batch keeps its history but stops accepting daily entries. */
export function BatchClosedNotice({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-sunk px-4 py-3">
      <ArchiveX size={16} className="text-muted-2 shrink-0" />
      <p className="text-[12px] text-muted leading-relaxed">
        Batch {code} is closed. History is read-only — no new daily entries.
      </p>
    </div>
  );
}
