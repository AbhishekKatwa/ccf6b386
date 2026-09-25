import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Surface } from '@/components/ui/Card';
import { SegmentedTabs } from '@/components/ui/Form';
import { PageReveal, ScrollReveal } from '@/components/motion';
import { EggStockByShedScreen } from './EggStockByShedScreen';
import { EggSalePlannerScreen } from './EggSalePlannerScreen';

type TabId = 'stock' | 'planner';

const TABS: { id: TabId; label: string }[] = [
  { id: 'stock', label: 'Egg Stock' },
  { id: 'planner', label: 'Sale Planner' },
];

export function EggsScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleTabChange = (tab: TabId) => {
    if (tab === activeTab) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(tab);
      setIsTransitioning(false);
    }, 200);
  };

  // Entrance animation on mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Page className={clsx(
      'transition-all duration-500 ease-out',
      mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
    )}>
      <PageReveal>
      <div className="space-y-5">
        {/* Header with animated entrance */}
        <ScrollReveal>
        <div className={clsx(
          'transition-all duration-700 ease-out delay-100',
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        )}>
          <ScreenTitle
            eyebrow="Eggs"
            title="Egg Stock & Sale Planner"
            subtitle="Stock visibility and sale planning across all sheds"
          />
        </div>
        </ScrollReveal>

        {/* Premium tab navigation with hover effects */}
        <ScrollReveal>
        <Surface className="p-1.5">
          <SegmentedTabs
            options={TABS.map(t => ({ value: t.id, label: t.label }))}
            value={activeTab}
            onChange={v => handleTabChange(v as TabId)}
          />
        </Surface>
        </ScrollReveal>

        {/* Content area with smooth transitions */}
        <div className={clsx(
          'transition-all duration-300 ease-in-out',
          isTransitioning ? 'opacity-0 scale-[0.99]' : 'opacity-100 scale-100'
        )}>
          {activeTab === 'stock' && <EggStockByShedScreen />}
          {activeTab === 'planner' && <EggSalePlannerScreen />}
        </div>
      </div>
      </PageReveal>
    </Page>
  );
}
