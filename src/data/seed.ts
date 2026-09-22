import type {
  AuditEntry, Batch, BatchAssignment, Company, DayLock, DeadBirdDisposal,
  EggCollection, EggSale, Farm, FarmTask, FeedConsumption, FeedFormula,
  FeedRound, FeedRoundLog, FeedStockEntry, FinanceTxn, MortalityEntry, SaleLog, Session, Shed, Trader,
  TraderTxn, User,
} from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { formulaDeduction, formulaForDate } from '@/lib/calc';
import { hashPassword } from '@/lib/auth';

const TODAY = new Date();
function dBack(n: number): string {
  const d = new Date(TODAY); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function dBackISO(n: number): string {
  const d = new Date(TODAY); d.setDate(d.getDate() - n);
  return d.toISOString();
}

/** Shared demo password for every seeded account. */
export const DEMO_PASSWORD = '1234';
const PW = hashPassword(DEMO_PASSWORD);

/* ============================= COMPANIES ============================= */

export const seedCompanies: Company[] = [
  { id: 'c_amrut', name: 'Amrut Poultry Farm', active: true, createdAt: dBackISO(400), updatedAt: dBackISO(2) },
  { id: 'c_sunrise', name: 'Sunrise Layers Pvt Ltd', active: true, createdAt: dBackISO(120), updatedAt: dBackISO(9) },
];

/* ============================= USERS ============================= */

export const seedUsers: User[] = [
  // Master Admin — global, belongs to no single company (companyIds: []).
  {
    id: 'u_master', name: 'Platform Admin', mobile: '9035526551', passwordHash: PW,
    role: 'MASTER_ADMIN', companyIds: [], initials: 'PA', active: true, createdAt: dBackISO(410), updatedAt: dBackISO(1),
  },
  // Amrut Poultry Farm
  {
    id: 'u_owner', name: 'Abhishek Katwa', mobile: '9035526552', passwordHash: PW,
    role: 'OWNER', companyIds: ['c_amrut'], initials: 'AK', active: true, createdAt: dBackISO(400), updatedAt: dBackISO(1),
  },
  {
    id: 'u_fsup', name: 'Ramesh Patil', mobile: '9876543210', passwordHash: PW,
    role: 'FARM_SUPERVISOR', companyIds: ['c_amrut'], initials: 'RP', active: true, createdAt: dBackISO(320), updatedAt: dBackISO(5),
  },
  {
    id: 'u_finsup', name: 'Priya Sharma', mobile: '9700000002', passwordHash: PW,
    role: 'FINANCIAL_SUPERVISOR', companyIds: ['c_amrut'], initials: 'PS', active: true, createdAt: dBackISO(150), updatedAt: dBackISO(12),
  },
  {
    id: 'u_mgr', name: 'Suresh Yadav', mobile: '9812345678', passwordHash: PW,
    role: 'FARM_MANAGER', companyIds: ['c_amrut'], initials: 'SY', active: true, createdAt: dBackISO(210), updatedAt: dBackISO(7),
  },
  {
    id: 'u_labor', name: 'Mohan Lal', mobile: '9700000001', passwordHash: PW,
    role: 'FARM_LABOR', companyIds: ['c_amrut'], initials: 'ML', active: true, createdAt: dBackISO(180), updatedAt: dBackISO(10),
  },
  // Sunrise Layers Pvt Ltd — proves company isolation.
  {
    id: 'u_owner2', name: 'Vikram Desai', mobile: '9822000001', passwordHash: PW,
    role: 'OWNER', companyIds: ['c_sunrise'], initials: 'VD', active: true, createdAt: dBackISO(120), updatedAt: dBackISO(3),
  },
  {
    id: 'u_fsup2', name: 'Ganesh More', mobile: '9822000002', passwordHash: PW,
    role: 'FARM_SUPERVISOR', companyIds: ['c_sunrise'], initials: 'GM', active: true, createdAt: dBackISO(90), updatedAt: dBackISO(4),
  },
];

/* ============================= FARMS / SHEDS ============================= */

export const seedFarms: Farm[] = [
  { id: 'f_main', companyId: 'c_amrut', name: 'Amrut Farm — Nashik', location: 'Nashik, Maharashtra', contactMobile: '9035526552', createdAt: dBackISO(400), updatedAt: dBackISO(2) },
  { id: 'f_sun', companyId: 'c_sunrise', name: 'Sunrise Farm — Pune', location: 'Pune, Maharashtra', contactMobile: '9822000001', createdAt: dBackISO(120), updatedAt: dBackISO(9) },
];

export const seedSheds: Shed[] = [
  { id: 's_g1', companyId: 'c_amrut', farmId: 'f_main', name: 'Gld-1', capacity: 30000, status: 'ACTIVE', farmSupervisorId: 'u_fsup', financialSupervisorId: 'u_finsup', createdAt: dBackISO(390), updatedAt: dBackISO(2) },
  { id: 's_g2', companyId: 'c_amrut', farmId: 'f_main', name: 'Gld-2', capacity: 25000, status: 'ACTIVE', farmSupervisorId: 'u_fsup', financialSupervisorId: 'u_finsup', createdAt: dBackISO(380), updatedAt: dBackISO(3) },
  { id: 's_b1', companyId: 'c_amrut', farmId: 'f_main', name: 'Br-1', capacity: 12000, status: 'IDLE', createdAt: dBackISO(370), updatedAt: dBackISO(30) },
  { id: 's_sun1', companyId: 'c_sunrise', farmId: 'f_sun', name: 'Sun-1', capacity: 20000, status: 'ACTIVE', farmSupervisorId: 'u_fsup2', createdAt: dBackISO(110), updatedAt: dBackISO(5) },
];

/* ============================= BATCHES ============================= */

export const seedBatches: Batch[] = [
  // Sequential batches in shed Gld-1: an older CLOSED one, then the ACTIVE one.
  {
    id: 'b_old', companyId: 'c_amrut', farmId: 'f_main', shedId: 's_g1', code: 'Gld1-A',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(700), placementDate: dBack(680),
    startDate: dBack(680), initialBirds: 28000, status: 'CLOSED',
    managerId: 'u_mgr', supervisorId: 'u_fsup',
    closing: { date: dBack(320), finalBirds: 26100, buyer: 'Nashik Birds Co', amount: 5220000, closedBy: 'u_owner', closedAt: dBackISO(320) },
    createdBy: 'u_owner', createdAt: dBackISO(690), updatedAt: dBackISO(320),
  },
  {
    id: 'b_gld1', companyId: 'c_amrut', farmId: 'f_main', shedId: 's_g1', code: 'Gld1-B',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(220), placementDate: dBack(205),
    startDate: dBack(205), initialBirds: 30000, status: 'ACTIVE',
    managerId: 'u_mgr', supervisorId: 'u_fsup',
    createdBy: 'u_owner', createdAt: dBackISO(210), updatedAt: dBackISO(1),
  },
  {
    id: 'b_gld2', companyId: 'c_amrut', farmId: 'f_main', shedId: 's_g2', code: 'Gld2-A',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(130), placementDate: dBack(115),
    startDate: dBack(115), initialBirds: 25000, status: 'ACTIVE',
    managerId: 'u_mgr', supervisorId: 'u_fsup',
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(1),
  },
  {
    id: 'b_sun1', companyId: 'c_sunrise', farmId: 'f_sun', shedId: 's_sun1', code: 'Sun1-A',
    birdType: 'LAYER', breed: 'BV-300', hatchDate: dBack(90), placementDate: dBack(80),
    startDate: dBack(80), initialBirds: 20000, status: 'ACTIVE',
    supervisorId: 'u_fsup2',
    createdBy: 'u_owner2', createdAt: dBackISO(85), updatedAt: dBackISO(1),
  },
];

export const seedAssignments: BatchAssignment[] = [
  { id: 'a1', companyId: 'c_amrut', batchId: 'b_gld1', userId: 'u_mgr', role: 'FARM_MANAGER', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_MANAGER, comments: 'Primary manager for Gld-1', assignedBy: 'u_owner', assignedAt: dBackISO(190) },
  { id: 'a2', companyId: 'c_amrut', batchId: 'b_gld1', userId: 'u_fsup', role: 'FARM_SUPERVISOR', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_SUPERVISOR, assignedBy: 'u_owner', assignedAt: dBackISO(180) },
  { id: 'a3', companyId: 'c_amrut', batchId: 'b_gld1', userId: 'u_labor', role: 'FARM_LABOR', permissions: DEFAULT_ROLE_PERMISSIONS.FARM_LABOR, assignedBy: 'u_mgr', assignedAt: dBackISO(170) },
];

/* ============================= DAILY OPERATIONS GENERATOR ============================= */

const SEED_DAYS = 21;

interface DailyGen {
  mortality: MortalityEntry[];
  disposals: DeadBirdDisposal[];
  feed: FeedConsumption[];
  rounds: FeedRoundLog[];
  eggs: EggCollection[];
  tonnesByShed: Record<string, number>;
}

/** 'HH:mm' from minutes past midnight. */
function clock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function generateDaily(
  companyId: string, batchId: string, shedId: string,
  days: number, isLayer: boolean, baseBirds: number, workerName: string,
): DailyGen {
  const mortality: MortalityEntry[] = [];
  const disposals: DeadBirdDisposal[] = [];
  const feed: FeedConsumption[] = [];
  const rounds: FeedRoundLog[] = [];
  const eggs: EggCollection[] = [];
  let cumMort = 0;
  let tonnes = 0;

  for (let i = days; i >= 0; i--) {
    const date = dBack(i);
    const mort = i === 0 ? 6 : Math.floor(Math.random() * 4) + (i % 7 === 0 ? 2 : 0);
    cumMort += mort;
    const live = Math.max(0, baseBirds - cumMort);

    mortality.push({
      id: `m_${batchId}_${date}`, companyId, batchId, shedId, date, count: mort, workerName,
      createdBy: 'u_fsup', createdAt: dBackISO(i), synced: i > 0,
    });
    disposals.push({
      id: `dp_${batchId}_${date}`, companyId, batchId, shedId, date, count: mort,
      method: 'Compost', workerName, createdBy: 'u_labor', createdAt: dBackISO(i), synced: i > 0,
    });

    // Layer: ~110 g/bird/day; Broiler: rising intake. Recorded in tonnes by the supervisor.
    const kg = isLayer ? live * 0.110 : live * (0.06 + (days - i) * 0.0035);
    const t = Number((kg / 1000).toFixed(3));
    tonnes += t;
    feed.push({
      id: `fc_${batchId}_${date}`, companyId, shedId, batchId, date, tonnes: t,
      createdBy: 'u_fsup', createdAt: dBackISO(i), synced: i > 0,
    });

    // Labor's feed rounds: the clock time the troughs were filled. Today's evening
    // round is still ahead of us, so the last day logs the morning one only.
    const planned: [FeedRound, number][] = [
      ['MORNING', 7 * 60 + 12 + (i % 22)],
      ['EVENING', 17 * 60 + 4 + (i % 26)],
    ];
    for (const [round, mins] of planned) {
      if (i === 0 && round === 'EVENING') continue;
      const skipped = round === 'EVENING' && i % 13 === 5;
      rounds.push({
        id: `fr_${batchId}_${date}_${round.toLowerCase()}`, companyId, batchId, shedId, date, round,
        status: skipped ? 'SKIPPED' : 'GIVEN', at: skipped ? '' : clock(mins), workerName,
        remarks: skipped ? 'Round missed — birds were being moved' : undefined,
        createdBy: 'u_labor', createdAt: dBackISO(i), synced: i > 0,
      });
    }

    if (isLayer) {
      const rate = 0.90 + Math.random() * 0.09;
      const totalEggs = Math.round(live * Math.min(1.0, rate));
      const goodTrays = Math.floor(totalEggs / 30);
      const brokenTrays = Math.round(goodTrays * (0.004 + Math.random() * 0.005));
      const doubleTrays = Math.round(goodTrays * (0.008 + Math.random() * 0.009));
      const smallTrays = Math.round(goodTrays * (0.014 + Math.random() * 0.018));
      eggs.push({
        id: `eg_${batchId}_${date}`, companyId, batchId, shedId, date,
        goodTrays, brokenTrays, doubleTrays, smallTrays, workerName,
        createdBy: 'u_labor', createdAt: dBackISO(i), synced: i > 0,
      });
    }
  }

  return { mortality, disposals, feed, rounds, eggs, tonnesByShed: { [shedId]: Number(tonnes.toFixed(2)) } };
}

const g1 = generateDaily('c_amrut', 'b_gld1', 's_g1', SEED_DAYS, true, 30000, 'Mohan Lal');
const g2 = generateDaily('c_amrut', 'b_gld2', 's_g2', SEED_DAYS, true, 25000, 'Mohan Lal');
const sun = generateDaily('c_sunrise', 'b_sun1', 's_sun1', SEED_DAYS, true, 20000, 'Ganesh More');

export const seedMortality: MortalityEntry[] = [...g1.mortality, ...g2.mortality, ...sun.mortality];
export const seedDisposals: DeadBirdDisposal[] = [...g1.disposals, ...g2.disposals, ...sun.disposals];
export const seedFeed: FeedConsumption[] = [...g1.feed, ...g2.feed, ...sun.feed];
export const seedFeedRounds: FeedRoundLog[] = [...g1.rounds, ...g2.rounds, ...sun.rounds];
export const seedEggs: EggCollection[] = [...g1.eggs, ...g2.eggs, ...sun.eggs];

/* ============================= SALE LOGS → TRADER SALES ============================= */

export const seedSaleLogs: SaleLog[] = [
  { id: 'sl_1', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(2), trays: 200, grade: 'GOOD', status: 'ACKNOWLEDGED', acknowledgedBy: 'u_finsup', acknowledgedAt: dBackISO(2), eggSaleId: 'es_1', workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(2), synced: true },
  { id: 'sl_2', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(1), trays: 150, grade: 'GOOD', status: 'ACKNOWLEDGED', acknowledgedBy: 'u_finsup', acknowledgedAt: dBackISO(1), eggSaleId: 'es_2', workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(1), synced: true },
  { id: 'sl_3', companyId: 'c_amrut', shedId: 's_g2', batchId: 'b_gld2', date: dBack(1), trays: 120, grade: 'GOOD', status: 'PENDING', workerName: 'Suresh Yadav', createdBy: 'u_mgr', createdAt: dBackISO(1), synced: true },
  { id: 'sl_4', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(3), trays: 3, grade: 'BROKEN', status: 'PENDING', workerName: 'Mohan Lal', remarks: 'Broken trays handed to local buyer', createdBy: 'u_labor', createdAt: dBackISO(3), synced: true },
  { id: 'sl_5', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(0), trays: 190, grade: 'GOOD', status: 'PENDING', workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(0), synced: false },
  { id: 'sl_6', companyId: 'c_amrut', shedId: 's_g2', batchId: 'b_gld2', date: dBack(0), trays: 6, grade: 'SMALL', status: 'PENDING', workerName: 'Mohan Lal', remarks: 'Small trays, weighted rate', createdBy: 'u_labor', createdAt: dBackISO(0), synced: false },
];

export const seedEggSales: EggSale[] = [
  { id: 'es_1', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2), trays: 200, grade: 'GOOD', ratePerTray: 150, amount: 30000, paymentStatus: 'PAID', saleLogIds: ['sl_1'], createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'es_2', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1), trays: 150, grade: 'GOOD', ratePerTray: 144, amount: 21600, paymentStatus: 'PARTIAL', saleLogIds: ['sl_2'], createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
];

/* ============================= TRADERS ============================= */

export const seedTraders: Trader[] = [
  { id: 't_rajesh', companyId: 'c_amrut', name: 'Rajesh Traders', mobile: '9822012345', gstin: '27AABCR1234F1Z5', address: 'Nashik Market Yard', openingBalance: 0, outstandingAmount: 0, active: true, createdAt: dBackISO(300), updatedAt: dBackISO(1) },
  { id: 't_meena', companyId: 'c_amrut', name: 'Meena Agencies', mobile: '9823033445', address: 'Pune', openingBalance: 0, outstandingAmount: 10800, active: true, createdAt: dBackISO(280), updatedAt: dBackISO(2) },
  { id: 't_suresh', companyId: 'c_amrut', name: 'Suresh Wholesale', mobile: '9970011223', gstin: '27AACCS5678K1Z2', address: 'Mumbai', openingBalance: 5000, outstandingAmount: 5000, active: true, createdAt: dBackISO(220), updatedAt: dBackISO(3) },
  { id: 't_kisan', companyId: 'c_sunrise', name: 'Kisan Egg House', mobile: '9860044556', address: 'Pune', openingBalance: 0, outstandingAmount: 0, active: true, createdAt: dBackISO(100), updatedAt: dBackISO(8) },
];

export const seedTraderTxns: TraderTxn[] = [
  { id: 'tt_1', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2), kind: 'EGG_SALE', trays: 200, rate: 150, amount: 30000, createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'tt_2', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2), kind: 'PAYMENT_IN', amount: 30000, remarks: 'UPI', createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'tt_3', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1), kind: 'EGG_SALE', trays: 150, rate: 144, amount: 21600, createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'tt_4', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1), kind: 'PAYMENT_IN', amount: 10800, remarks: 'Partial', createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'tt_5', companyId: 'c_amrut', traderId: 't_suresh', date: dBack(30), kind: 'OPENING', amount: 5000, remarks: 'Opening balance', createdBy: 'u_owner', createdAt: dBackISO(30), synced: true },
];

/* ============================= GODOWN (KG) ============================= */

const OPENING: [string, number, number][] = [
  ['Maize', 45000, 24.5],
  ['Soya DOC', 18000, 48.0],
  ['DDGS', 12000, 28.0],
  ['Groundnut DOC', 8000, 22.0],
  ['DORB', 4000, 22.0],
  ['Stone', 18000, 6.5],
  ['MCP', 2500, 62.0],
  ['DLM', 600, 320.0],
  ['Lysine', 400, 240.0],
  ['Salt', 1200, 12.0],
  ['Mixiblend', 1100, 180.0],
];

export const seedFeedStock: FeedStockEntry[] = [
  ...OPENING.map(([ing, qty, rate], i) => ({
    id: `fs_open_${i}`, companyId: 'c_amrut', ingredient: ing, date: dBack(30),
    kind: 'OPENING' as const, qtyKg: qty, ratePerKg: rate,
    createdBy: 'u_finsup', createdAt: dBackISO(30), synced: true,
  })),
  { id: 'fs_in_1', companyId: 'c_amrut', ingredient: 'Maize', date: dBack(15), kind: 'FEED_IN', qtyKg: 60000, ratePerKg: 25.0, remarks: 'Purchase — Anand Feeds (1200 bags)', createdBy: 'u_finsup', createdAt: dBackISO(15), synced: true },
  { id: 'fs_in_2', companyId: 'c_amrut', ingredient: 'Soya DOC', date: dBack(10), kind: 'FEED_IN', qtyKg: 22000, ratePerKg: 49.5, createdBy: 'u_finsup', createdAt: dBackISO(10), synced: true },
  // Sunrise godown (isolation demo)
  { id: 'fs_sun_open', companyId: 'c_sunrise', ingredient: 'Maize', date: dBack(30), kind: 'OPENING', qtyKg: 20000, ratePerKg: 25.5, createdBy: 'u_owner2', createdAt: dBackISO(30), synced: true },
];

/* ============================= FEED FORMULAS (per Shed, kg/tonne) ============================= */

export const seedFeedFormulas: FeedFormula[] = [
  {
    id: 'ff_g1', companyId: 'c_amrut', shedId: 's_g1', name: 'Gld-1 — Layer Peak',
    familyId: 'ff_g1', version: 1, effectiveFrom: dBack(120), status: 'INACTIVE',
    supersededAt: dBackISO(10),
    items: [
      { ingredient: 'Maize', kgPerTonne: 560, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', kgPerTonne: 230, costPerKg: 49.5 },
      { ingredient: 'DDGS', kgPerTonne: 60, costPerKg: 28.0 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 32, costPerKg: 22.0 },
      { ingredient: 'Stone', kgPerTonne: 95, costPerKg: 6.5 },
      { ingredient: 'MCP', kgPerTonne: 10, costPerKg: 62.0 },
      { ingredient: 'DLM', kgPerTonne: 2.2, costPerKg: 320.0 },
      { ingredient: 'Lysine', kgPerTonne: 1.8, costPerKg: 240.0 },
      { ingredient: 'Salt', kgPerTonne: 4, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', kgPerTonne: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(10),
  },
  {
    id: 'ff_g1_v2', companyId: 'c_amrut', shedId: 's_g1', name: 'Gld-1 — Layer Peak',
    familyId: 'ff_g1', version: 2, effectiveFrom: dBack(10), status: 'ACTIVE',
    changeReason: 'Maize pulled down, DORB added',
    items: [
      { ingredient: 'Maize', kgPerTonne: 530, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', kgPerTonne: 240, costPerKg: 49.5 },
      { ingredient: 'DDGS', kgPerTonne: 60, costPerKg: 28.0 },
      { ingredient: 'DORB', kgPerTonne: 30, costPerKg: 22.0 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 30, costPerKg: 22.0 },
      { ingredient: 'Stone', kgPerTonne: 90, costPerKg: 6.5 },
      { ingredient: 'MCP', kgPerTonne: 8, costPerKg: 62.0 },
      { ingredient: 'DLM', kgPerTonne: 2, costPerKg: 320.0 },
      { ingredient: 'Lysine', kgPerTonne: 2, costPerKg: 240.0 },
      { ingredient: 'Salt', kgPerTonne: 3, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', kgPerTonne: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_fsup', createdAt: dBackISO(10), updatedAt: dBackISO(10),
  },
  {
    id: 'ff_g2', companyId: 'c_amrut', shedId: 's_g2', name: 'Gld-2 — Layer Peak',
    familyId: 'ff_g2', version: 1, effectiveFrom: dBack(120), status: 'ACTIVE',
    items: [
      { ingredient: 'Maize', kgPerTonne: 555, costPerKg: 25.0 },
      { ingredient: 'Soya DOC', kgPerTonne: 232, costPerKg: 49.5 },
      { ingredient: 'DDGS', kgPerTonne: 62, costPerKg: 28.0 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 31, costPerKg: 22.0 },
      { ingredient: 'Stone', kgPerTonne: 97, costPerKg: 6.5 },
      { ingredient: 'MCP', kgPerTonne: 10, costPerKg: 62.0 },
      { ingredient: 'DLM', kgPerTonne: 2.2, costPerKg: 320.0 },
      { ingredient: 'Lysine', kgPerTonne: 1.8, costPerKg: 240.0 },
      { ingredient: 'Salt', kgPerTonne: 4, costPerKg: 12.0 },
      { ingredient: 'Mixiblend', kgPerTonne: 5, costPerKg: 180.0 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(15),
  },
];

// Each historical entry keeps the formula version that was in force on its date,
// and the godown ledger mirrors those same deductions.
const consumptionEntries: FeedStockEntry[] = [];
const tonnesByFormula = new Map<string, { formula: FeedFormula; tonnes: number }>();
seedFeed.forEach((row, idx) => {
  const formula = formulaForDate(row.shedId, row.date, seedFeedFormulas);
  if (!formula || formula.companyId !== row.companyId) return;
  seedFeed[idx] = {
    ...row,
    formulaId: formula.id,
    formulaVersion: formula.version,
    formulaName: formula.name,
    deduction: formulaDeduction(formula, row.tonnes).filter(d => d.kg > 0),
  };
  const group = tonnesByFormula.get(formula.id) ?? { formula, tonnes: 0 };
  group.tonnes += row.tonnes;
  tonnesByFormula.set(formula.id, group);
});
for (const { formula, tonnes } of tonnesByFormula.values()) {
  formulaDeduction(formula, tonnes).forEach((d, idx) => {
    if (d.kg <= 0) return;
    consumptionEntries.push({
      id: `fs_cons_${formula.id}_${idx}`, companyId: formula.companyId, ingredient: d.ingredient,
      date: dBack(0), kind: 'CONSUMPTION', qtyKg: d.kg, shedId: formula.shedId,
      remarks: `${tonnes.toFixed(1)} t consumed on ${formula.name} V${formula.version}`,
      createdBy: 'u_fsup', createdAt: dBackISO(0), synced: true,
    });
  });
}
seedFeedStock.push(...consumptionEntries);

/* ============================= FINANCE ============================= */

export const seedFinance: FinanceTxn[] = [
  { id: 'fx_1', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(2), kind: 'SALE', amount: 30000, category: 'Egg Sale', counterparty: 'Rajesh Traders', createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'fx_2', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(1), kind: 'SALE', amount: 21600, category: 'Egg Sale', counterparty: 'Meena Agencies', createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'fx_4', companyId: 'c_amrut', date: dBack(5), kind: 'EXPENSE', amount: 1250000, category: 'Feed Purchase', counterparty: 'Anand Feeds', createdBy: 'u_finsup', createdAt: dBackISO(5), synced: true },
  { id: 'fx_6', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(10), kind: 'EXPENSE', amount: 42000, category: 'Labour', createdBy: 'u_finsup', createdAt: dBackISO(10), synced: true },
  { id: 'fx_7', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(12), kind: 'EXPENSE', amount: 28000, category: 'Medicine', createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },
  { id: 'fx_9', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(0), kind: 'INCOME', amount: 5000, category: 'Manure Sale', createdBy: 'u_owner', createdAt: dBackISO(0), synced: true },
];

/* ============================= TASKS ============================= */

export const seedTasks: FarmTask[] = [
  { id: 'tk_1', companyId: 'c_amrut', title: 'Morning feed — Gld-1', date: dBack(0), time: '06:30', assignedUserId: 'u_labor', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'HIGH', status: 'COMPLETED', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(0), synced: true },
  { id: 'tk_2', companyId: 'c_amrut', title: 'Egg collection — Gld-1', date: dBack(0), time: '09:00', assignedUserId: 'u_labor', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'HIGH', status: 'IN_PROGRESS', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(0), synced: false },
  { id: 'tk_3', companyId: 'c_amrut', title: 'Water sanitation check', date: dBack(0), time: '11:00', assignedUserId: 'u_fsup', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'MEDIUM', status: 'PENDING', createdBy: 'u_mgr', createdAt: dBackISO(1), updatedAt: dBackISO(1), synced: true },
  { id: 'tk_5', companyId: 'c_amrut', title: 'Dispose dead birds — Gld-1', date: dBack(0), time: '16:00', assignedUserId: 'u_labor', farmId: 'f_main', shedId: 's_g1', batchId: 'b_gld1', priority: 'MEDIUM', status: 'PENDING', createdBy: 'u_fsup', createdAt: dBackISO(0), updatedAt: dBackISO(0), synced: false },
  { id: 'tk_6', companyId: 'c_sunrise', title: 'Feed stock reconciliation', date: dBack(0), time: '18:00', assignedUserId: 'u_fsup2', farmId: 'f_sun', shedId: 's_sun1', priority: 'LOW', status: 'PENDING', createdBy: 'u_owner2', createdAt: dBackISO(0), updatedAt: dBackISO(0), synced: true },
];

/* ============================= DAY LOCKS / AUDIT ============================= */

export const seedDayLocks: DayLock[] = [
  { id: 'dl_1', companyId: 'c_amrut', batchId: 'b_gld1', shedId: 's_g1', date: dBack(7), lockedBy: 'u_owner', lockedAt: dBackISO(7), reason: 'Week close' },
];

export const seedAudit: AuditEntry[] = [
  { id: 'au_1', companyId: 'c_amrut', entity: 'Batch', entityId: 'b_gld1', action: 'CREATE', byUserId: 'u_owner', at: dBackISO(210) },
  { id: 'au_2', companyId: 'c_amrut', entity: 'DayLock', entityId: 'b_gld1', action: 'LOCK', field: dBack(7), oldValue: false, newValue: true, byUserId: 'u_owner', at: dBackISO(7) },
];

export const seedSession: Session | null = null;
