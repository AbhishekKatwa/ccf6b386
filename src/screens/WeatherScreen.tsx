import { CloudSun, Droplets, Wind, Thermometer, Sun, CloudRain } from 'lucide-react';
import { Header, Page } from '@/components/ui/Header';
import { Card, GroupList, ListRow } from '@/components/ui/Card';

const FORECAST = [
  { day: 'Today', icon: Sun, hi: 32, lo: 24, rain: 10 },
  { day: 'Tue', icon: CloudSun, hi: 31, lo: 23, rain: 20 },
  { day: 'Wed', icon: CloudRain, hi: 28, lo: 22, rain: 70 },
  { day: 'Thu', icon: CloudRain, hi: 27, lo: 22, rain: 80 },
  { day: 'Fri', icon: CloudSun, hi: 30, lo: 23, rain: 30 },
];

export function WeatherScreen() {
  return (
    <Page withNav>
      <Header title="Weather" subtitle="Nashik, Maharashtra" />
      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <div className="rounded-[22px] bg-brand text-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/60 text-xs uppercase tracking-wider font-mono">Current</p>
              <p className="font-display font-bold text-6xl mt-1 tnum">31°</p>
              <p className="text-white/70 text-xs mt-1">Partly cloudy · Feels like 34°</p>
            </div>
            <CloudSun size={64} className="text-accent" />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5 divide-x divide-white/15">
            {[
              { icon: Droplets, v: '62%', l: 'Humidity' },
              { icon: Wind, v: '12 km/h', l: 'Wind' },
              { icon: Thermometer, v: '32° / 24°', l: 'Hi / Lo' },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.l} className="px-3 text-center first:pl-0 last:pr-0">
                  <Icon size={15} className="mx-auto text-white/60" />
                  <p className="font-display font-bold text-sm mt-1.5 tnum">{s.v}</p>
                  <p className="text-[9px] text-white/60 uppercase tracking-wider mt-0.5">{s.l}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-[22px] bg-accent-soft p-4">
          <p className="font-display font-bold text-accent-ink text-sm">Poultry advisory</p>
          <p className="text-xs text-accent-ink/80 mt-1 leading-relaxed">
            High humidity expected — increase ventilation and monitor water intake. Rain forecast Wed–Thu: secure feed godown and check shed roofing.
          </p>
        </div>

        <div>
          <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">5-day forecast</p>
          <GroupList>
            {FORECAST.map(f => {
              const Icon = f.icon;
              const wet = f.rain > 50;
              return (
                <ListRow key={f.day}
                  leading={<span className="w-11 text-sm font-semibold text-ink">{f.day}</span>}
                  title={
                    <span className="flex items-center gap-2">
                      <Icon size={19} className={wet ? 'text-brand' : 'text-accent'} />
                      <span className="flex-1 h-1.5 bg-sunk rounded-full overflow-hidden min-w-[40px]">
                        <span className={`block h-full rounded-full ${wet ? 'bg-brand' : 'bg-accent'}`} style={{ width: `${f.rain}%` }} />
                      </span>
                      <span className="text-[11px] text-muted font-mono tnum w-8 text-right">{f.rain}%</span>
                    </span>
                  }
                  trailing={<span className="font-mono tnum font-bold text-sm text-ink flex-shrink-0">{f.hi}° / {f.lo}°</span>} />
              );
            })}
          </GroupList>
          <Card className="mt-3">
            <p className="text-[11px] text-muted leading-relaxed">
              Rain probability shown per day. Sample forecast for demonstration.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
