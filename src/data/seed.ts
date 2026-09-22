import type {
  AuditEntry, Batch, BatchAssignment, DayLock, EggCollection, EggSale,
  Farm, FarmTask, FeedConsumption, FeedFormula, FeedStockEntry, FinanceTxn,
  MortalityEntry, Session, Shed, Trader, TraderTxn, User, WeightEntry,
} from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';

const TODAY = new Date();
function dBack(n: number): string {
  const d = new Date(TODAY); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function dBackISO(n: number): string {
  const d = new Date(TODAY); d.setDate(d.getDate() - n);
  return d.toISOString();
}

export const seedUsers: User[] = [
  {
    id: 'u_owner', name: 'Abhishek Katwa', mobile: '9035526551',
    email: 'abhishek@amrutpoultry.in', role: 'OWNER',
    permissions: DEFAULT_ROLE_PERMISSIONS.OWNER, initials: 'AK', active: true,
    createdAt: dBackISO(400), updatedAt: dBackISO(1),
  },
  {
    id: 'u_mgr', name: 'Ramesh Patil', mobile: '9876543210',
    role: 'FARM_MANAGER', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_MANAGER,
    initials: 'RP', active: true,
    createdAt: dBackISO(320), updatedAt: dBackISO(5),
  },
  {
    id: 'u_sup', name: 'Suresh Yadav', mobile: '9812345678',
    role: 'FARM_SUPERVISOR', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_SUPERVISOR,
    initials: 'SY', active: true,
    createdAt: dBackISO(210), updatedAt: dBackISO(7),
  },
  {
    id: 'u_emp', name: 'Mohan Lal', mobile: '9700000001',
    role: 'FARM_EMPLOYEE', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_EMPLOYEE,
    initials: 'ML', active: true,
    createdAt: dBackISO(180), updatedAt: dBackISO(10),
  },
  {
    id: 'u_fin', name: 'Priya Sharma', mobile: '9700000002',
    role: 'FINANCER', permissions: DEFAULT_ROLE_PERMISSIONS.FINANCER,
    initials: 'PS', active: true,
    createdAt: dBackISO(150), updatedAt: dBackISO(12),
  },
];

export const seedFarms: Farm[] = [
  {
    id: 'f_main', name: 'Amrut Farm — Nashik', location: 'Nashik, Maharashtra',
    ownerUserId: 'u_owner', contactMobile: '9035526551',
    createdAt: dBackISO(400), updatedAt: dBackISO(2),
  },
  {
    id: 'f_sat', name: 'Amrut Farm — Sangola', location: 'Sangola, Maharashtra',
    ownerUserId: 'u_owner', contactMobile: '9035526551',
    createdAt: dBackISO(260), updatedAt: dBackISO(20),
  },
];

export const seedSheds: Shed[] = [
  { id: 's_g1', farmId: 'f_main', name: 'Gld-1', capacity: 30000, status: 'ACTIVE', createdAt: dBackISO(390), updatedAt: dBackISO(2) },
  { id: 's_g2', farmId: 'f_main', name: 'Gld-2', capacity: 25000, status: 'ACTIVE', createdAt: dBackISO(380), updatedAt: dBackISO(3) },
  { id: 's_b1', farmId: 'f_main', name: 'Br-1', capacity: 12000, status: 'IDLE', createdAt: dBackISO(370), updatedAt: dBackISO(30) },
  { id: 's_s1', farmId: 'f_sat', name: 'Sg-1', capacity: 18000, status: 'ACTIVE', createdAt: dBackISO(240), updatedAt: dBackISO(4) },
];

export const seedBatches: Batch[] = [
  {
    id: 'b_gld1', code: 'Gld1', farmId: 'f_main', shedId: 's_g1',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(220), placementDate: dBack(205),
    initialBirds: 30000, status: 'LIVE',
    createdBy: 'u_owner', createdAt: dBackISO(210), updatedAt: dBackISO(1),
  },
  {
    id: 'b_gld2', code: 'Gld2', farmId: 'f_main', shedId: 's_g2',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(130), placementDate: dBack(115),
    initialBirds: 25000, status: 'LIVE',
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(1),
  },
  {
    id: 'b_sg1', code: 'Sg1', farmId: 'f_sat', shedId: 's_s1',
    birdType: 'BROILER', breed: 'Cobb 500', hatchDate: dBack(40), placementDate: dBack(38),
    initialBirds: 18000, status: 'LIVE',
    createdBy: 'u_owner', createdAt: dBackISO(40), updatedAt: dBackISO(1),
  },
  {
    id: 'b_old', code: 'Gld0', farmId: 'f_main', shedId: 's_b1',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(700), placementDate: dBack(680),
    initialBirds: 28000, status: 'CLOSED',
    createdBy: 'u_owner', createdAt: dBackISO(690), updatedAt: dBackISO(180),
  },
];

export const seedAssignments: BatchAssignment[] = [
  {
    id: 'a1', batchId: 'b_gld1', userId: 'u_mgr', role: 'FARM_MANAGER',
    permissions: { ...DEFAULT_ROLE_PERMISSIONS.FARM_MANAGER, create: true },
    comments: 'Primary manager for Gld1', assignedBy: 'u_owner', assignedAt: dBackISO(190),
  },
  {
    id: 'a2', batchId: 'b_gld1', userId: 'u_sup', role: 'FARM_SUPERVISOR',
    permissions: DEFAULT_ROLE_PERMISSIONS.FARM_SUPERVISOR,
    assignedBy: 'u_owner', assignedAt: dBackISO(180),
  },
];

function generateDailyBatchData(batchId: string, days: number, isLayer: boolean, baseBirds: number) {
  const mortality: MortalityEntry[] = [];
  const feed: FeedConsumption[] = [];
  const eggs: EggCollection[] = [];
  const weights: WeightEntry[] = [];
  let live = baseBirds;
  let cumMort = 0;

  for (let i = days; i >= 0; i--) {
    const date = dBack(i);
    const mort = i === 0 ? 6 : Math.floor(Math.random() * 4) + (i % 7 === 0 ? 2 : 0);
    cumMort += mort;
    live = Math.max(0, baseBirds - cumMort);

    mortality.push({
      id: `m_${batchId}_${date}`, batchId, date, count: mort,
      createdBy: 'u_mgr', createdAt: dBackISO(i), synced: i > 0,
    });

    const bags = isLayer
      ? Math.round((live * 0.110) / 50)
      : Math.round((live * (0.06 + (days - i) * 0.0035)) / 50);
    feed.push({
      id: `f_${batchId}_${date}`, batchId, date, bags, bagWeightKg: 50,
      createdBy: 'u_mgr', createdAt: dBackISO(i), synced: i > 0,
    });

    if (isLayer) {
      const rate = 0.92 + Math.random() * 0.09;
      const total = Math.round(live * Math.min(1.02, rate));
      const damaged = Math.round(total * (0.0004 + Math.random() * 0.0008));
      const cracked = Math.round(total * (0.0003 + Math.random() * 0.0004));
      eggs.push({
        id: `e_${batchId}_${date}`, batchId, date,
        good: total - damaged - cracked, damaged, cracked,
        createdBy: 'u_mgr', createdAt: dBackISO(i), synced: i > 0,
      });
    }

    if (!isLayer && i % 7 === 0) {
      const dayAge = days - i + 1;
      const avg = 0.045 + dayAge * 0.058;
      weights.push({
        id: `w_${batchId}_${date}`, batchId, date, sampleSize: 50,
        avgWeightKg: Number(avg.toFixed(3)),
        createdBy: 'u_mgr', createdAt: dBackISO(i), synced: true,
      });
    }
  }

  return { mortality, feed, eggs, weights };
}

const g1 = generateDailyBatchData('b_gld1', 30, true, 30000);
const g2 = generateDailyBatchData('b_gld2', 30, true, 25000);
const sg = generateDailyBatchData('b_sg1', 30, false, 18000);

export const seedMortality: MortalityEntry[] = [...g1.mortality, ...g2.mortality, ...sg.mortality];
export const seedFeed: FeedConsumption[] = [...g1.feed, ...g2.feed, ...sg.feed];
export const seedEggs: EggCollection[] = [...g1.eggs, ...g2.eggs];
export const seedWeights: WeightEntry[] = [...sg.weights];

export const seedEggSales: EggSale[] = [
  {
    id: 'es_1', batchId: 'b_gld1', traderId: 't_rajesh', date: dBack(0),
    buyerName: 'Rajesh Traders', trays: 200, eggsPerTray: 30, ratePerEgg: 5.00,
    paymentStatus: 'PAID', createdBy: 'u_owner', createdAt: dBackISO(0), synced: true,
  },
  {
    id: 'es_2', batchId: 'b_gld1', traderId: 't_meena', date: dBack(1),
    buyerName: 'Meena Agencies', trays: 150, eggsPerTray: 30, ratePerEgg: 4.80,
    paymentStatus: 'PARTIAL', createdBy: 'u_owner', createdAt: dBackISO(1), synced: true,
  },
  {
    id: 'es_3', batchId: 'b_gld1', traderId: 't_suresh', date: dBack(2),
    buyerName: 'Suresh Wholesale', trays: 107, eggsPerTray: 30, ratePerEgg: 5.10,
    paymentStatus: 'PENDING', createdBy: 'u_owner', createdAt: dBackISO(2), synced: true,
  },
  {
    id: 'es_4', batchId: 'b_gld2', traderId: 't_rajesh', date: dBack(1),
    buyerName: 'Rajesh Traders', trays: 120, eggsPerTray: 30, ratePerEgg: 4.95,
    paymentStatus: 'PAID', createdBy: 'u_owner', createdAt: dBackISO(1), synced: true,
  },
];

export const seedFeedStock: FeedStockEntry[] = [
  { id: 'fs_1', ingredient: 'Maize', date: dBack(30), kind: 'OPENING', qtyKg: 45000, ratePerKg: 24.5, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_2', ingredient: 'Maize', date: dBack(15), kind: 'PURCHASE', qtyKg: 60000, ratePerKg: 25.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(15), synced: true },
  { id: 'fs_3', ingredient: 'Maize', date: dBack(0), kind: 'CONSUMPTION', qtyKg: 28500, ratePerKg: 0, unit: 'KG', createdBy: 'u_mgr', createdAt: dBackISO(0), synced: false },
  { id: 'fs_4', ingredient: 'Soya DOC', date: dBack(30), kind: 'OPENING', qtyKg: 18000, ratePerKg: 48.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_5', ingredient: 'Soya DOC', date: dBack(10), kind: 'PURCHASE', qtyKg: 22000, ratePerKg: 49.5, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(10), synced: true },
  { id: 'fs_6', ingredient: 'DDGS', date: dBack(30), kind: 'OPENING', qtyKg: 6000, ratePerKg: 28.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_7', ingredient: 'Stone', date: dBack(30), kind: 'OPENING', qtyKg: 3500, ratePerKg: 6.5, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_8', ingredient: 'MCP', date: dBack(30), kind: 'OPENING', qtyKg: 1200, ratePerKg: 62.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_9', ingredient: 'DLM', date: dBack(30), kind: 'OPENING', qtyKg: 480, ratePerKg: 320.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_10', ingredient: 'Lysine', date: dBack(30), kind: 'OPENING', qtyKg: 320, ratePerKg: 240.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_11', ingredient: 'Salt', date: dBack(30), kind: 'OPENING', qtyKg: 900, ratePerKg: 12.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
  { id: 'fs_12', ingredient: 'Mixiblend', date: dBack(30), kind: 'OPENING', qtyKg: 750, ratePerKg: 180.0, unit: 'KG', createdBy: 'u_fin', createdAt: dBackISO(30), synced: true },
];

export const seedFeedFormulas: FeedFormula[] = [
  {
    id: 'ff_layer_pre', name: 'Layer — Pre-Lay (W14–W18)', birdType: 'LAYER',
    ageFromDays: 98, ageToDays: 126,
    items: [
      { ingredient: 'Maize', qtyKg: 540, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', qtyKg: 220, costPerKg: 49.5 },
      { ingredient: 'DDGS', qtyKg: 80, costPerKg: 28.0 },
      { ingredient: 'DORB', qtyKg: 60, costPerKg: 22.0 },
      { ingredient: 'Stone', qtyKg: 70, costPerKg: 6.5 },
      { ingredient: 'MCP', qtyKg: 12, costPerKg: 62.0 },
      { ingredient: 'DLM', qtyKg: 2.0, costPerKg: 320.0 },
      { ingredient: 'Lysine', qtyKg: 1.5, costPerKg: 240.0 },
      { ingredient: 'Salt', qtyKg: 4, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', qtyKg: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(30),
  },
  {
    id: 'ff_layer_peak', name: 'Layer — Peak (W19–W45)', birdType: 'LAYER',
    ageFromDays: 127, ageToDays: 315,
    items: [
      { ingredient: 'Maize', qtyKg: 560, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', qtyKg: 230, costPerKg: 49.5 },
      { ingredient: 'DDGS', qtyKg: 60, costPerKg: 28.0 },
      { ingredient: 'Stone', qtyKg: 95, costPerKg: 6.5 },
      { ingredient: 'MCP', qtyKg: 10, costPerKg: 62.0 },
      { ingredient: 'DLM', qtyKg: 2.2, costPerKg: 320.0 },
      { ingredient: 'Lysine', qtyKg: 1.8, costPerKg: 240.0 },
      { ingredient: 'Salt', qtyKg: 4, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', qtyKg: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(15),
  },
  {
    id: 'ff_broiler_st', name: 'Broiler — Starter (D1–D21)', birdType: 'BROILER',
    ageFromDays: 1, ageToDays: 21,
    items: [
      { ingredient: 'Maize', qtyKg: 580, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', qtyKg: 320, costPerKg: 49.5 },
      { ingredient: 'DDGS', qtyKg: 40, costPerKg: 28.0 },
      { ingredient: 'MCP', qtyKg: 14, costPerKg: 62.0 },
      { ingredient: 'DLM', qtyKg: 3.0, costPerKg: 320.0 },
      { ingredient: 'Lysine', qtyKg: 3.0, costPerKg: 240.0 },
      { ingredient: 'Salt', qtyKg: 4, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', qtyKg: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(100), updatedAt: dBackISO(20),
  },
];

export const seedFinance: FinanceTxn[] = [
  { id: 'fx_1', batchId: 'b_gld1', date: dBack(0), kind: 'SALE', amount: 30000, category: 'Egg Sale', counterparty: 'Rajesh Traders', createdBy: 'u_owner', createdAt: dBackISO(0), synced: true },
  { id: 'fx_2', batchId: 'b_gld1', date: dBack(1), kind: 'SALE', amount: 21600, category: 'Egg Sale', counterparty: 'Meena Agencies', createdBy: 'u_owner', createdAt: dBackISO(1), synced: true },
  { id: 'fx_3', batchId: 'b_gld1', date: dBack(2), kind: 'SALE', amount: 16320, category: 'Egg Sale', counterparty: 'Suresh Wholesale', createdBy: 'u_owner', createdAt: dBackISO(2), synced: true },
  { id: 'fx_4', batchId: 'b_gld1', date: dBack(5), kind: 'EXPENSE', amount: 1250000, category: 'Feed Purchase', counterparty: 'Anand Feeds', createdBy: 'u_fin', createdAt: dBackISO(5), synced: true },
  { id: 'fx_5', batchId: 'b_gld1', date: dBack(8), kind: 'EXPENSE', amount: 180000, category: 'Chick Purchase', createdBy: 'u_fin', createdAt: dBackISO(8), synced: true },
  { id: 'fx_6', batchId: 'b_gld1', date: dBack(10), kind: 'EXPENSE', amount: 42000, category: 'Labour', createdBy: 'u_fin', createdAt: dBackISO(10), synced: true },
  { id: 'fx_7', batchId: 'b_gld1', date: dBack(12), kind: 'EXPENSE', amount: 28000, category: 'Medicine', createdBy: 'u_fin', createdAt: dBackISO(12), synced: true },
  { id: 'fx_8', batchId: 'b_gld2', date: dBack(1), kind: 'SALE', amount: 17820, category: 'Egg Sale', counterparty: 'Rajesh Traders', createdBy: 'u_owner', createdAt: dBackISO(1), synced: true },
  { id: 'fx_9', batchId: 'b_gld1', date: dBack(0), kind: 'INCOME', amount: 5000, category: 'Manure Sale', createdBy: 'u_owner', createdAt: dBackISO(0), synced: true },
];

export const seedTraders: Trader[] = [
  { id: 't_rajesh', name: 'Rajesh Traders', mobile: '9822012345', gstin: '27AABCR1234F1Z5', address: 'Nashik Market Yard', outstandingAmount: 0, active: true, createdAt: dBackISO(300), updatedAt: dBackISO(1) },
  { id: 't_meena', name: 'Meena Agencies', mobile: '9823033445', address: 'Pune', outstandingAmount: 10800, active: true, createdAt: dBackISO(280), updatedAt: dBackISO(2) },
  { id: 't_suresh', name: 'Suresh Wholesale', mobile: '9970011223', gstin: '27AACCS5678K1Z2', address: 'Mumbai', outstandingAmount: 16320, active: true, createdAt: dBackISO(220), updatedAt: dBackISO(3) },
  { id: 't_kisan', name: 'Kisan Egg House', mobile: '9860044556', address: 'Sangola', outstandingAmount: 0, active: true, createdAt: dBackISO(180), updatedAt: dBackISO(8) },
];

export const seedTraderTxns: TraderTxn[] = [
  { id: 'tt_1', traderId: 't_rajesh', date: dBack(0), kind: 'EGG_SALE', qty: 6000, rate: 5.00, amount: 30000, createdBy: 'u_owner', createdAt: dBackISO(0), synced: true },
  { id: 'tt_2', traderId: 't_rajesh', date: dBack(0), kind: 'PAYMENT_IN', amount: 30000, remarks: 'UPI', createdBy: 'u_fin', createdAt: dBackISO(0), synced: true },
  { id: 'tt_3', traderId: 't_meena', date: dBack(1), kind: 'EGG_SALE', qty: 4500, rate: 4.80, amount: 21600, createdBy: 'u_owner', createdAt: dBackISO(1), synced: true },
  { id: 'tt_4', traderId: 't_meena', date: dBack(1), kind: 'PAYMENT_IN', amount: 10800, remarks: 'Partial', createdBy: 'u_fin', createdAt: dBackISO(1), synced: true },
  { id: 'tt_5', traderId: 't_suresh', date: dBack(2), kind: 'EGG_SALE', qty: 3210, rate: 5.10, amount: 16320, createdBy: 'u_owner', createdAt: dBackISO(2), synced: true },
  { id: 'tt_6', traderId: 't_suresh', date: dBack(7), kind: 'RATE_UPDATE', rate: 5.05, amount: 0, remarks: 'Weekly rate', createdBy: 'u_owner', createdAt: dBackISO(7), synced: true },
];

export const seedTasks: FarmTask[] = [
  { id: 'tk_1', title: 'Morning feed — Gld1', date: dBack(0), time: '06:30', assignedUserId: 'u_emp', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'HIGH', status: 'COMPLETED', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(0), synced: true },
  { id: 'tk_2', title: 'Egg collection — Gld1', date: dBack(0), time: '09:00', assignedUserId: 'u_emp', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'HIGH', status: 'IN_PROGRESS', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(0), synced: false },
  { id: 'tk_3', title: 'Water sanitation check', date: dBack(0), time: '11:00', assignedUserId: 'u_sup', farmId: 'f_main', batchId: 'b_gld1', priority: 'MEDIUM', status: 'PENDING', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(1), synced: true },
  { id: 'tk_4', title: 'Evenage — Gld2 culling', date: dBack(0), time: '16:00', assignedUserId: 'u_mgr', farmId: 'f_main', batchId: 'b_gld2', priority: 'MEDIUM', status: 'PENDING', createdBy: 'u_owner', createdAt: dBackISO(2), updatedAt: dBackISO(2), synced: true },
  { id: 'tk_5', title: 'Vaccination — Sg1 (Day 38)', date: dBack(-1), time: '07:00', assignedUserId: 'u_sup', farmId: 'f_sat', batchId: 'b_sg1', priority: 'URGENT', status: 'PENDING', createdBy: 'u_owner', createdAt: dBackISO(0), updatedAt: dBackISO(0), synced: false },
  { id: 'tk_6', title: 'Feed stock reconciliation', date: dBack(-2), time: '18:00', assignedUserId: 'u_fin', farmId: 'f_main', priority: 'LOW', status: 'PENDING', createdBy: 'u_owner', createdAt: dBackISO(0), updatedAt: dBackISO(0), synced: true },
];

export const seedDayLocks: DayLock[] = [
  { batchId: 'b_gld1', date: dBack(7), lockedBy: 'u_owner', lockedAt: dBackISO(7), reason: 'Month-end close' },
];

export const seedAudit: AuditEntry[] = [
  { id: 'au_1', entity: 'Batch', entityId: 'b_gld1', action: 'CREATE', byUserId: 'u_owner', at: dBackISO(210) },
  { id: 'au_2', entity: 'DayLock', entityId: 'b_gld1', action: 'LOCK', field: dBack(7), oldValue: false, newValue: true, byUserId: 'u_owner', at: dBackISO(7) },
];

export const seedSession: Session | null = null;
