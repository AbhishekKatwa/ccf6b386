import { useSearchParams } from 'react-router-dom';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Surface } from '@/components/ui/Card';
import { SegmentedTabs } from '@/components/ui/Form';
import { PageReveal, ScrollReveal, TabPanel } from '@/components/motion';
import { EggStockByShedScreen } from './EggStockByShedScreen';
import { EggSalePlannerScreen } from './EggSalePlannerScreen';

type TabId = 'stock' | 'planner';

const TABS: { id: TabId; label: string }[] = [
  { id: 'stock', label: 'Egg Stock' },
  { id: 'planner', label: 'Sale Planner' },
];

export function EggsScreen() {
  // The tab lives in the URL, so an alert or a search result can open the planner itself
  // rather than the screen's default tab.
  const [params, setParams] = useSearchParams();
  const activeTab: TabId = params.get('tab') === 'planner' ? 'planner' : 'stock';

  function selectTab(next: TabId) {
    setParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', next);
      return p;
    }, { replace: true });
  }

  return (
    <Page withNav>
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
                onChange={v => selectTab(v as TabId)}
              />
            </Surface>
          </div>
        </ScrollReveal>

        <TabPanel id={activeTab}>
          {activeTab === 'stock' && <EggStockByShedScreen />}
          {activeTab === 'planner' && <EggSalePlannerScreen />}
        </TabPanel>
      </div>
      </PageReveal>
    </Page>
  );
}
