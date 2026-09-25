import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Surface } from '@/components/ui/Card';
import { SegmentedTabs } from '@/components/ui/Form';
import { PageReveal, ScrollReveal, useReducedMotion } from '@/components/motion';
import { EggStockByShedScreen } from './EggStockByShedScreen';
import { EggSalePlannerScreen } from './EggSalePlannerScreen';

type TabId = 'stock' | 'planner';

const TABS: { id: TabId; label: string }[] = [
  { id: 'stock', label: 'Egg Stock' },
  { id: 'planner', label: 'Sale Planner' },
];

export function EggsScreen() {
  const [activeTab, setActiveTab] = useState<TabId>('stock');
  const reduced = useReducedMotion();

  return (
    <Page>
      <PageReveal>
      <div className="space-y-5">
        <ScreenTitle
          eyebrow="Eggs"
          title="Egg Stock & Sale Planner"
          subtitle="Stock visibility and sale planning across all sheds"
        />

        <ScrollReveal>
          <div className="px-4 sm:px-0">
            <Surface className="p-1.5">
              <SegmentedTabs
                options={TABS.map(t => ({ value: t.id, label: t.label }))}
                value={activeTab}
                onChange={v => setActiveTab(v as TabId)}
              />
            </Surface>
          </div>
        </ScrollReveal>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {activeTab === 'stock' && <EggStockByShedScreen />}
            {activeTab === 'planner' && <EggSalePlannerScreen />}
          </motion.div>
        </AnimatePresence>
      </div>
      </PageReveal>
    </Page>
  );
}
