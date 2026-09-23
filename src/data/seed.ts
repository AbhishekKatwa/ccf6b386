import type {
  AuditEntry, Batch, BatchAssignment, Company, DayLock,
  EggCollection, Farm, FarmTask, FeedConsumption, FeedFormula,
  FeedRound, FeedRoundLog, FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, MortalityEntry, SaleEntry, SaleLog, Session, Shed, Trader,
  TraderTxn, User, VaccinationItem, VaccinationTemplate,
} from '@/types';
import { EMPTY_GRADE_COUNTS } from '@/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';
import { formulaDeduction, formulaForDate } from '@/lib/calc';
import { shiftDate } from '@/lib/format';
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

/* ============================= VACCINATION =============================
 * A placed flock carries its own plan, dated from its own placement day. The demo spread is
 * deliberate — a dose overdue, one due today, one coming up, one further out, doses given on
 * time, one given late and one called off — so the module opens on a working calendar rather
 * than an empty grid. The reminder states themselves are never stored here: they are what the
 * scheduled dates read as on the day the screen is opened.
 */

/** Templates count their days from placement, so a plan fits any batch regardless of dates. */
export const seedVaccinationTemplates: VaccinationTemplate[] = [
  {
    id: 'vt_layer', companyId: 'c_amrut', name: 'Layer standard plan', birdType: 'LAYER', active: true,
    items: [
      { relativeDay: 1, vaccineName: "Marek's HVT", reminderDaysBefore: 0, dose: '0.5 ml/bird', route: 'Injection', remarks: 'Given at the hatchery before dispatch' },
      { relativeDay: 7, vaccineName: 'Newcastle B1', reminderDaysBefore: 3, dose: '2 drops per eye', route: 'Eye drop' },
      { relativeDay: 14, vaccineName: 'IBD (Gumaro)', reminderDaysBefore: 3, dose: '1 dose/bird', route: 'Drinking water', remarks: 'Flush the line and withhold water for an hour first' },
      { relativeDay: 21, vaccineName: 'Lasota + IBD booster', reminderDaysBefore: 3, dose: '1 dose/bird', route: 'Drinking water' },
      { relativeDay: 35, vaccineName: 'Fowl pox', reminderDaysBefore: 7, dose: '1 drop per wing web', route: 'Spray' },
      { relativeDay: 60, vaccineName: 'DCT (fowl typhoid)', reminderDaysBefore: 7, dose: '1 ml/bird', route: 'Injection' },
      { relativeDay: 120, vaccineName: 'Raniket + IB', reminderDaysBefore: 7, dose: '0.5 ml/bird', route: 'Injection', remarks: 'Before the lay period opens' },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(690), updatedAt: dBackISO(60),
  },
  {
    id: 'vt_broiler', companyId: 'c_amrut', name: 'Broiler standard plan', birdType: 'BROILER', active: true,
    items: [
      { relativeDay: 1, vaccineName: 'Marek\'s HVT + ND B1', reminderDaysBefore: 0, dose: '0.5 ml/bird', route: 'Injection' },
      { relativeDay: 7, vaccineName: 'Newcastle B1', reminderDaysBefore: 1, dose: '1 dose/bird', route: 'Drinking water' },
      { relativeDay: 14, vaccineName: 'IBD (Gumaro)', reminderDaysBefore: 1, dose: '1 dose/bird', route: 'Drinking water' },
      { relativeDay: 21, vaccineName: 'IBD booster', reminderDaysBefore: 1, dose: '1 dose/bird', route: 'Drinking water' },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(300), updatedAt: dBackISO(300),
  },
  {
    id: 'vt_old_plan', companyId: 'c_amrut', name: 'Old layer plan (2019)', active: false,
    items: [
      { relativeDay: 7, vaccineName: 'Newcastle B1', reminderDaysBefore: 1, route: 'Drinking water' },
      { relativeDay: 21, vaccineName: 'Lasota', reminderDaysBefore: 1, route: 'Drinking water' },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(700), updatedAt: dBackISO(420),
  },
  {
    id: 'vt_sun', companyId: 'c_sunrise', name: 'Sunrise layer plan', birdType: 'LAYER', active: true,
    items: [
      { relativeDay: 1, vaccineName: "Marek's HVT", reminderDaysBefore: 0, dose: '0.5 ml/bird', route: 'Injection' },
      { relativeDay: 7, vaccineName: 'Newcastle B1', reminderDaysBefore: 3, dose: '1 dose/bird', route: 'Drinking water' },
      { relativeDay: 14, vaccineName: 'IBD (Gumaro)', reminderDaysBefore: 3, dose: '1 dose/bird', route: 'Drinking water' },
      { relativeDay: 35, vaccineName: 'Fowl pox', reminderDaysBefore: 7, dose: '1 drop per wing web', route: 'Spray' },
    ],
    createdBy: 'u_owner2', createdAt: dBackISO(115), updatedAt: dBackISO(115),
  },
];

/** One line of a batch's plan, counted in flock-days from placement. */
interface ScheduleSeed {
  day: number;
  vaccine: string;
  remind: number;
  dose?: string;
  route?: string;
  remarks?: string;
  /** Given on this flock-day — a day past `day` records the dose as late, with both dates standing. */
  given?: number;
  by?: string;
  /** Called off, with the reason that stays on the record. */
  off?: string;
}

const STAMPED = (day: string) => `${day}T05:30:00.000Z`;

function scheduleFor(batch: Batch, rows: ScheduleSeed[]): VaccinationItem[] {
  return rows.map(r => {
    const scheduledDate = shiftDate(batch.placementDate, r.day);
    const createdAt = STAMPED(scheduledDate);
    const base = {
      id: `vac_${batch.id}_${r.day}`, companyId: batch.companyId,
      batchId: batch.id, shedId: batch.shedId, relativeDay: r.day,
      vaccineName: r.vaccine, scheduledDate, reminderDaysBefore: r.remind,
      dose: r.dose, route: r.route, remarks: r.remarks,
      createdBy: 'u_owner', createdAt, synced: true,
    };
    if (r.given !== undefined) {
      const completedDate = shiftDate(batch.placementDate, r.given);
      return {
        ...base, status: 'COMPLETED' as const, actualDose: r.dose,
        completedDate, completedAt: STAMPED(completedDate),
        completedBy: r.by ?? 'Ramesh Patil',
        updatedAt: STAMPED(completedDate),
      };
    }
    if (r.off) {
      return {
        ...base, status: 'CANCELLED' as const,
        cancelledAt: createdAt, cancelledBy: 'u_owner', cancellationReason: r.off,
        updatedAt: createdAt,
      };
    }
    return { ...base, status: 'SCHEDULED' as const, updatedAt: createdAt };
  });
}

/** Keyed by batch so every line is dated from the flock it belongs to. */
const SEED_SCHEDULES: Record<string, ScheduleSeed[]> = {
  // Placed 205 days ago, so today reads as flock-day 205.
  b_gld1: [
    { day: 1, vaccine: "Marek's HVT", remind: 0, dose: '0.5 ml/bird', route: 'Injection', remarks: 'Given at the hatchery before dispatch', given: 1 },
    { day: 7, vaccine: 'Newcastle B1', remind: 3, dose: '2 drops per eye', route: 'Eye drop', given: 7 },
    { day: 14, vaccine: 'IBD (Gumaro)', remind: 3, dose: '1 dose/bird', route: 'Drinking water', given: 16, by: 'Mohan Lal', remarks: 'Water line flushed before the dose' },
    { day: 21, vaccine: 'Lasota + IBD booster', remind: 3, dose: '1 dose/bird', route: 'Drinking water', given: 21 },
    { day: 35, vaccine: 'Fowl pox', remind: 7, dose: '1 drop per wing web', route: 'Spray', given: 35, by: 'Suresh Yadav' },
    { day: 60, vaccine: 'DCT (fowl typhoid)', remind: 7, dose: '1 ml/bird', route: 'Injection', given: 60 },
    { day: 120, vaccine: 'Raniket + IB', remind: 7, dose: '0.5 ml/bird', route: 'Injection', given: 120 },
    { day: 150, vaccine: "Marek's revaccination", remind: 3, off: 'Dropped — the hatchery certificate covers this flock' },
    { day: 202, vaccine: 'Kerajet (ND + IB killed)', remind: 3, dose: '0.5 ml/bird', route: 'Injection' },
    { day: 205, vaccine: 'ILT booster', remind: 1, dose: '2 drops per eye', route: 'Eye drop' },
    { day: 212, vaccine: 'Fowl pox booster', remind: 7, dose: '1 drop per wing web', route: 'Spray' },
    { day: 235, vaccine: 'Deworming (Levamisol)', remind: 3, dose: '7 mg per kg live weight', route: 'Drinking water' },
  ],
  // Placed 115 days ago.
  b_gld2: [
    { day: 1, vaccine: "Marek's HVT", remind: 0, dose: '0.5 ml/bird', route: 'Injection', given: 1 },
    { day: 7, vaccine: 'Newcastle B1', remind: 3, route: 'Eye drop', given: 7 },
    { day: 14, vaccine: 'IBD (Gumaro)', remind: 3, route: 'Drinking water', given: 14 },
    { day: 21, vaccine: 'Lasota + IBD booster', remind: 3, route: 'Drinking water', given: 24, by: 'Mohan Lal' },
    { day: 35, vaccine: 'Fowl pox', remind: 7, route: 'Spray', given: 35 },
    { day: 60, vaccine: 'DCT (fowl typhoid)', remind: 7, route: 'Injection', given: 60 },
    { day: 78, vaccine: "Marek's revaccination", remind: 3, off: 'Cancelled on review — this breed does not need it' },
    { day: 112, vaccine: 'Kerajet (ND + IB killed)', remind: 3, route: 'Injection' },
    { day: 115, vaccine: 'ILT booster', remind: 1, route: 'Eye drop' },
    { day: 118, vaccine: 'Raniket booster', remind: 3, route: 'Injection' },
    { day: 140, vaccine: 'Deworming (Levamisol)', remind: 3, route: 'Drinking water' },
  ],
  // Sunrise Layers, placed 80 days ago — the other company's own flock.
  b_sun1: [
    { day: 1, vaccine: "Marek's HVT", remind: 0, route: 'Injection', given: 1, by: 'Ganesh More' },
    { day: 7, vaccine: 'Newcastle B1', remind: 3, route: 'Drinking water', given: 7, by: 'Ganesh More' },
    { day: 14, vaccine: 'IBD (Gumaro)', remind: 3, route: 'Drinking water', given: 14, by: 'Ganesh More' },
    { day: 70, vaccine: 'Kerajet (ND + IB killed)', remind: 3, route: 'Injection' },
    { day: 80, vaccine: 'ILT booster', remind: 1, route: 'Eye drop' },
    { day: 86, vaccine: 'Fowl pox', remind: 7, route: 'Spray' },
  ],
  // A sold-off flock: the plan stands as history, and the one line still open on it is a
  // record of what never happened rather than a task anyone is owed.
  b_old: [
    { day: 1, vaccine: "Marek's HVT", remind: 0, route: 'Injection', given: 1 },
    { day: 7, vaccine: 'Newcastle B1', remind: 3, route: 'Eye drop', given: 7 },
    { day: 14, vaccine: 'IBD (Gumaro)', remind: 3, route: 'Drinking water', given: 14 },
    { day: 60, vaccine: 'DCT (fowl typhoid)', remind: 7, route: 'Injection', given: 60 },
    { day: 330, vaccine: 'Deworming (Levamisol)', remind: 3, route: 'Drinking water', off: 'Flock was sold before the round came' },
    { day: 355, vaccine: 'Raniket before dispatch', remind: 3, route: 'Injection' },
  ],
};

export const seedVaccinations: VaccinationItem[] =
  seedBatches.flatMap(b => scheduleFor(b, SEED_SCHEDULES[b.id] ?? []));

/* ============================= DAILY OPERATIONS GENERATOR ============================= */

const SEED_DAYS = 21;

interface DailyGen {
  mortality: MortalityEntry[];
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

  return { mortality, feed, rounds, eggs, tonnesByShed: { [shedId]: Number(tonnes.toFixed(2)) } };
}

const g1 = generateDaily('c_amrut', 'b_gld1', 's_g1', SEED_DAYS, true, 30000, 'Mohan Lal');
const g2 = generateDaily('c_amrut', 'b_gld2', 's_g2', SEED_DAYS, true, 25000, 'Mohan Lal');
const sun = generateDaily('c_sunrise', 'b_sun1', 's_sun1', SEED_DAYS, true, 20000, 'Ganesh More');

export const seedMortality: MortalityEntry[] = [...g1.mortality, ...g2.mortality, ...sun.mortality];
export const seedFeed: FeedConsumption[] = [...g1.feed, ...g2.feed, ...sun.feed];
export const seedFeedRounds: FeedRoundLog[] = [...g1.rounds, ...g2.rounds, ...sun.rounds];
export const seedEggs: EggCollection[] = [...g1.eggs, ...g2.eggs, ...sun.eggs];

/* ============================= SHED DISPATCH LOGS ============================= */

export const seedSaleLogs: SaleLog[] = [
  { id: 'sl_1', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(2), trays: 200, grade: 'GOOD', status: 'ACKNOWLEDGED', acknowledgedBy: 'u_finsup', acknowledgedAt: dBackISO(2), workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(2), synced: true },
  { id: 'sl_2', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(1), trays: 150, grade: 'GOOD', status: 'ACKNOWLEDGED', acknowledgedBy: 'u_finsup', acknowledgedAt: dBackISO(1), workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(1), synced: true },
  { id: 'sl_3', companyId: 'c_amrut', shedId: 's_g2', batchId: 'b_gld2', date: dBack(1), trays: 120, grade: 'GOOD', status: 'PENDING', workerName: 'Suresh Yadav', createdBy: 'u_mgr', createdAt: dBackISO(1), synced: true },
  { id: 'sl_4', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(3), trays: 3, grade: 'BROKEN', status: 'PENDING', workerName: 'Mohan Lal', remarks: 'Broken trays handed to local buyer', createdBy: 'u_labor', createdAt: dBackISO(3), synced: true },
  { id: 'sl_5', companyId: 'c_amrut', shedId: 's_g1', batchId: 'b_gld1', date: dBack(0), trays: 190, grade: 'GOOD', status: 'PENDING', workerName: 'Mohan Lal', createdBy: 'u_mgr', createdAt: dBackISO(0), synced: false },
  { id: 'sl_6', companyId: 'c_amrut', shedId: 's_g2', batchId: 'b_gld2', date: dBack(0), trays: 6, grade: 'SMALL', status: 'PENDING', workerName: 'Mohan Lal', remarks: 'Small trays, weighted rate', createdBy: 'u_labor', createdAt: dBackISO(0), synced: false },
];

/* ============================= SALE ENTRIES (accounts → trader) =============================
 * These are what reduce shed stock and carry the money. A load is billed as its eggs
 * plus the loading labour recovered on it; whatever cash, PhonePe and advance do not
 * cover stays as the trader's balance. Each entry matches the ledger rows below. */

export const seedSaleEntries: SaleEntry[] = [
  {
    id: 'se_1', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2),
    lines: [{ shedId: 's_g1', byGrade: { ...EMPTY_GRADE_COUNTS, GOOD: 200 } }],
    rates: { GOOD: 5 }, pricing: 'RATE', amount: 30000,
    cash: 26200, phonepe: 5000, advance: 0, credit: 0, laborCharge: 1200,
    remarks: 'Van pick-up, weighed at the gate',
    createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true,
  },
  {
    id: 'se_2', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1),
    lines: [{ shedId: 's_g1', byGrade: { ...EMPTY_GRADE_COUNTS, GOOD: 150 } }],
    rates: { GOOD: 4.8 }, pricing: 'RATE', amount: 21600,
    cash: 10800, phonepe: 0, advance: 0, credit: 11600, laborCharge: 800,
    createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true,
  },
  {
    id: 'se_3', companyId: 'c_amrut', traderId: 't_suresh', date: dBack(4),
    lines: [
      { shedId: 's_g1', byGrade: { ...EMPTY_GRADE_COUNTS, GOOD: 100, BROKEN: 6, DOUBLE: 4, SMALL: 10 } },
      { shedId: 's_g2', byGrade: { ...EMPTY_GRADE_COUNTS, GOOD: 80 } },
    ],
    rates: {}, pricing: 'AGREED', amount: 26400,
    cash: 12000, phonepe: 5400, advance: 0, credit: 9600, laborCharge: 600,
    remarks: 'Mixed load, one figure agreed with the owner',
    createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true,
  },
];

/* ============================= TRADERS ============================= */

export const seedTraders: Trader[] = [
  { id: 't_rajesh', companyId: 'c_amrut', name: 'Rajesh Traders', mobile: '9822012345', gstin: '27AABCR1234F1Z5', address: 'Nashik Market Yard', openingBalance: 0, outstandingAmount: 0, active: true, createdAt: dBackISO(300), updatedAt: dBackISO(1) },
  { id: 't_meena', companyId: 'c_amrut', name: 'Meena Agencies', mobile: '9823033445', address: 'Pune', openingBalance: 0, outstandingAmount: 11600, active: true, createdAt: dBackISO(280), updatedAt: dBackISO(2) },
  { id: 't_suresh', companyId: 'c_amrut', name: 'Suresh Wholesale', mobile: '9970011223', gstin: '27AACCS5678K1Z2', address: 'Mumbai', openingBalance: 5000, outstandingAmount: 14600, active: true, createdAt: dBackISO(220), updatedAt: dBackISO(4) },
  { id: 't_kisan', companyId: 'c_sunrise', name: 'Kisan Egg House', mobile: '9860044556', address: 'Pune', openingBalance: 0, outstandingAmount: 0, active: true, createdAt: dBackISO(100), updatedAt: dBackISO(8) },
];

export const seedTraderTxns: TraderTxn[] = [
  { id: 'tt_1', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2), kind: 'EGG_SALE', trays: 200, rate: 5, amount: 31200, refId: 'se_1', remarks: 'Van pick-up, weighed at the gate', createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'tt_2', companyId: 'c_amrut', traderId: 't_rajesh', date: dBack(2), kind: 'PAYMENT_IN', amount: 31200, refId: 'se_1', split: { cash: 26200, online: 5000 }, createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'tt_3', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1), kind: 'EGG_SALE', trays: 150, rate: 4.8, amount: 22400, refId: 'se_2', createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'tt_4', companyId: 'c_amrut', traderId: 't_meena', date: dBack(1), kind: 'PAYMENT_IN', amount: 10800, refId: 'se_2', paymentMethod: 'CASH', split: { cash: 10800 }, createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'tt_6', companyId: 'c_amrut', traderId: 't_suresh', date: dBack(4), kind: 'EGG_SALE', trays: 200, rate: 4.4, amount: 27000, refId: 'se_3', remarks: 'Mixed load, one figure agreed with the owner', createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
  { id: 'tt_7', companyId: 'c_amrut', traderId: 't_suresh', date: dBack(4), kind: 'PAYMENT_IN', amount: 17400, refId: 'se_3', split: { cash: 12000, online: 5400 }, createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
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
  { id: 'fs_in_1', companyId: 'c_amrut', ingredient: 'Maize', date: dBack(15), kind: 'FEED_IN', qtyKg: 60000, ratePerKg: 25.0, supplier: 'Anand Feeds', purchaseRef: `PUR-${dBack(15)}-001`, remarks: 'Purchase — Anand Feeds (1200 bags)', createdBy: 'u_finsup', createdAt: dBackISO(15), synced: true },
  { id: 'fs_in_2', companyId: 'c_amrut', ingredient: 'Soya DOC', date: dBack(10), kind: 'FEED_IN', qtyKg: 22000, ratePerKg: 49.5, purchaseRef: `PUR-${dBack(10)}-001`, createdBy: 'u_finsup', createdAt: dBackISO(10), synced: true },
  // Sunrise godown (isolation demo)
  { id: 'fs_sun_open', companyId: 'c_sunrise', ingredient: 'Maize', date: dBack(30), kind: 'OPENING', qtyKg: 20000, ratePerKg: 25.5, createdBy: 'u_owner2', createdAt: dBackISO(30), synced: true },
];

/* ============================= MEDICINES & VACCINES (CENTRAL INVENTORY) =============================
 * The shed's own store cupboard, ledgered the way the godown is: what is standing, what it
 * cost, and where it went. Nothing here is stored as a balance — every figure on the screen is
 * read back off these rows, so a stock that was never bought cannot appear, and one that was
 * is never rounded down to ₹0 when its rate is missing.
 */

export const seedMedicineItems: MedicineItem[] = [
  { id: 'mi_enro', companyId: 'c_amrut', name: 'Enrofloxacin 10% Oral Solution', category: 'MEDICINE', unit: 'bottle', active: true, lowStockThreshold: 5, specifications: '100 ml bottle', createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(12) },
  { id: 'mi_para', companyId: 'c_amrut', name: 'Paracetamol Powder', category: 'MEDICINE', unit: 'sachet', active: true, lowStockThreshold: 40, specifications: '500 g sachet', createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(45) },
  { id: 'mi_msv', companyId: 'c_amrut', name: 'Multivitamin (Vita-Sol)', category: 'MEDICINE', unit: 'packet', active: true, lowStockThreshold: 10, specifications: '1 kg packet', createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(12) },
  { id: 'mi_leva', companyId: 'c_amrut', name: 'Levamisol Dewormer', category: 'MEDICINE', unit: 'sachet', active: true, lowStockThreshold: 8, createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(45) },
  { id: 'mi_form', companyId: 'c_amrut', name: 'Formalin', category: 'MEDICINE', unit: 'litre', active: true, lowStockThreshold: 4, remarks: 'Shed and equipment disinfection', createdBy: 'u_fsup', createdAt: dBackISO(45), updatedAt: dBackISO(45) },
  { id: 'mi_ilt', companyId: 'c_amrut', name: 'ILT Vaccine', category: 'VACCINE', unit: 'vial', active: true, lowStockThreshold: 6, specifications: '1000-dose vial', createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(12) },
  { id: 'mi_pox', companyId: 'c_amrut', name: 'Fowl Pox Vaccine', category: 'VACCINE', unit: 'vial', active: true, lowStockThreshold: 6, specifications: '1000-dose vial', createdBy: 'u_finsup', createdAt: dBackISO(45), updatedAt: dBackISO(12) },
  { id: 'mi_oxy', companyId: 'c_amrut', name: 'Oxytetracycline 20% WSP', category: 'MEDICINE', unit: 'packet', active: true, lowStockThreshold: 5, remarks: 'Kept for a veterinary order; nothing in stock', createdBy: 'u_finsup', createdAt: dBackISO(20), updatedAt: dBackISO(20) },
  // Sunrise Layers — its own cupboard, never visible to Amrut and the other way round.
  { id: 'mi_sun_oxy', companyId: 'c_sunrise', name: 'Oxytetracycline 20% WSP', category: 'MEDICINE', unit: 'packet', active: true, lowStockThreshold: 5, createdBy: 'u_owner2', createdAt: dBackISO(40), updatedAt: dBackISO(40) },
  { id: 'mi_sun_nd', companyId: 'c_sunrise', name: 'Newcastle B1 Vaccine', category: 'VACCINE', unit: 'vial', active: true, lowStockThreshold: 4, createdBy: 'u_owner2', createdAt: dBackISO(40), updatedAt: dBackISO(9) },
];

/** Forward-dated so a lot expiry reads as a real date ahead of the demo day. */
function dFwd(n: number): string {
  const d = new Date(TODAY); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const seedMedicineStock: MedicineStockEntry[] = [
  // Opening position, carried in from before the ledger started.
  { id: 'ms_open_enro', companyId: 'c_amrut', medicineId: 'mi_enro', date: dBack(45), kind: 'OPENING', qty: 20, ratePerUnit: 420, createdBy: 'u_finsup', createdAt: dBackISO(45), synced: true },
  { id: 'ms_open_para', companyId: 'c_amrut', medicineId: 'mi_para', date: dBack(45), kind: 'OPENING', qty: 60, ratePerUnit: 35, createdBy: 'u_finsup', createdAt: dBackISO(45), synced: true },
  { id: 'ms_open_msv', companyId: 'c_amrut', medicineId: 'mi_msv', date: dBack(45), kind: 'OPENING', qty: 25, ratePerUnit: 180, createdBy: 'u_finsup', createdAt: dBackISO(45), synced: true },
  { id: 'ms_open_leva', companyId: 'c_amrut', medicineId: 'mi_leva', date: dBack(45), kind: 'OPENING', qty: 12, ratePerUnit: 95, createdBy: 'u_finsup', createdAt: dBackISO(45), synced: true },
  { id: 'ms_open_form', companyId: 'c_amrut', medicineId: 'mi_form', date: dBack(45), kind: 'OPENING', qty: 10, ratePerUnit: 140, createdBy: 'u_fsup', createdAt: dBackISO(45), synced: true },
  { id: 'ms_open_pox', companyId: 'c_amrut', medicineId: 'mi_pox', date: dBack(45), kind: 'OPENING', qty: 30, ratePerUnit: 210, createdBy: 'u_finsup', createdAt: dBackISO(45), synced: true },

  // A receipt re-weights the average it lands on: Enrofloxacin 20 @ ₹420 + 30 @ ₹460 → ₹444.
  { id: 'ms_in_enro', companyId: 'c_amrut', medicineId: 'mi_enro', date: dBack(12), kind: 'RECEIPT', qty: 30, ratePerUnit: 460, supplier: 'Poona Vet Suppliers', purchaseRef: `MED-${dBack(12)}-001`, lotNumber: 'EN-2291', expiryDate: dFwd(300), remarks: 'Against order VO/2291', createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },
  { id: 'ms_in_msv', companyId: 'c_amrut', medicineId: 'mi_msv', date: dBack(12), kind: 'RECEIPT', qty: 40, ratePerUnit: 195, supplier: 'Poona Vet Suppliers', purchaseRef: `MED-${dBack(12)}-002`, lotNumber: 'MV-7741', expiryDate: dFwd(18), createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },
  { id: 'ms_in_pox', companyId: 'c_amrut', medicineId: 'mi_pox', date: dBack(12), kind: 'RECEIPT', qty: 20, ratePerUnit: 180, supplier: 'Sahyadri Biologicals', purchaseRef: `MED-${dBack(12)}-003`, lotNumber: 'FP-3312', expiryDate: dBack(4), remarks: 'Cold-chain delivery; lot expired before it was used up', createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },
  // Bought, not yet paid for — it stands in Outstanding Payables until Finance settles it.
  { id: 'ms_in_ilt', companyId: 'c_amrut', medicineId: 'mi_ilt', date: dBack(12), kind: 'RECEIPT', qty: 50, ratePerUnit: 260, supplier: 'Sahyadri Biologicals', purchaseRef: `MED-${dBack(12)}-004`, lotNumber: 'IL-5520', expiryDate: dFwd(240), createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },

  // Stock that left for a shed's own use, valued at the average in force when it went.
  { id: 'ms_use_enro_g2', companyId: 'c_amrut', medicineId: 'mi_enro', date: dBack(6), kind: 'USAGE', qty: 6, ratePerUnit: 444, amount: 2664, shedId: 's_g2', batchId: 'b_gld2', reason: 'Treatment', usedBy: 'Ramesh Patil', remarks: 'Water medication, 5 days', createdBy: 'u_mgr', createdAt: dBackISO(6), synced: true },
  { id: 'ms_use_para_g1', companyId: 'c_amrut', medicineId: 'mi_para', date: dBack(2), kind: 'USAGE', qty: 25, ratePerUnit: 35, amount: 875, shedId: 's_g1', batchId: 'b_gld1', reason: 'Heat stress', usedBy: 'Mohan Lal', createdBy: 'u_fsup', createdAt: dBackISO(2), synced: true },
  { id: 'ms_use_ilt_g1', companyId: 'c_amrut', medicineId: 'mi_ilt', date: dBack(2), kind: 'USAGE', qty: 18, ratePerUnit: 260, amount: 4680, shedId: 's_g1', batchId: 'b_gld1', reason: 'Vaccination', usedBy: 'Ramesh Patil', remarks: 'Drinking water round, shed emptied beforehand', createdBy: 'u_fsup', createdAt: dBackISO(2), synced: true },

  { id: 'ms_sun_open', companyId: 'c_sunrise', medicineId: 'mi_sun_nd', date: dBack(40), kind: 'OPENING', qty: 12, ratePerUnit: 240, createdBy: 'u_owner2', createdAt: dBackISO(40), synced: true },
  { id: 'ms_sun_in', companyId: 'c_sunrise', medicineId: 'mi_sun_nd', date: dBack(9), kind: 'RECEIPT', qty: 20, ratePerUnit: 255, supplier: 'Bharat Vet Supplies', purchaseRef: `MED-${dBack(9)}-001`, lotNumber: 'ND-1180', expiryDate: dFwd(120), createdBy: 'u_owner2', createdAt: dBackISO(9), synced: true },
];

/* ============================= FEED FORMULAS (per Shed, kg/tonne) ============================= */

export const seedFeedFormulas: FeedFormula[] = [
  {
    id: 'ff_g1', companyId: 'c_amrut', shedId: 's_g1', name: 'Gld-1 — Layer Peak',
    familyId: 'ff_g1', version: 1, effectiveFrom: dBack(120), status: 'INACTIVE',
    supersededAt: dBackISO(10),
    items: [
      { ingredient: 'Maize', kgPerTonne: 560 },
      { ingredient: 'Soya DOC', kgPerTonne: 230 },
      { ingredient: 'DDGS', kgPerTonne: 60 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 32 },
      { ingredient: 'Stone', kgPerTonne: 95 },
      { ingredient: 'MCP', kgPerTonne: 10 },
      { ingredient: 'DLM', kgPerTonne: 2.2 },
      { ingredient: 'Lysine', kgPerTonne: 1.8 },
      { ingredient: 'Salt', kgPerTonne: 4 },
      { ingredient: 'Mixiblend', kgPerTonne: 5 },
    ],
    createdBy: 'u_owner', createdAt: dBackISO(120), updatedAt: dBackISO(10),
  },
  {
    id: 'ff_g1_v2', companyId: 'c_amrut', shedId: 's_g1', name: 'Gld-1 — Layer Peak',
    familyId: 'ff_g1', version: 2, effectiveFrom: dBack(10), status: 'ACTIVE',
    changeReason: 'Maize pulled down, DORB added',
    items: [
      { ingredient: 'Maize', kgPerTonne: 530 },
      { ingredient: 'Soya DOC', kgPerTonne: 240 },
      { ingredient: 'DDGS', kgPerTonne: 60 },
      { ingredient: 'DORB', kgPerTonne: 30 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 30 },
      { ingredient: 'Stone', kgPerTonne: 90 },
      { ingredient: 'MCP', kgPerTonne: 8 },
      { ingredient: 'DLM', kgPerTonne: 2 },
      { ingredient: 'Lysine', kgPerTonne: 2 },
      { ingredient: 'Salt', kgPerTonne: 3 },
      { ingredient: 'Mixiblend', kgPerTonne: 5 },
    ],
    createdBy: 'u_fsup', createdAt: dBackISO(10), updatedAt: dBackISO(10),
  },
  {
    id: 'ff_g2', companyId: 'c_amrut', shedId: 's_g2', name: 'Gld-2 — Layer Peak',
    familyId: 'ff_g2', version: 1, effectiveFrom: dBack(120), status: 'ACTIVE',
    items: [
      { ingredient: 'Maize', kgPerTonne: 555 },
      { ingredient: 'Soya DOC', kgPerTonne: 232 },
      { ingredient: 'DDGS', kgPerTonne: 62 },
      { ingredient: 'Groundnut DOC', kgPerTonne: 31 },
      { ingredient: 'Stone', kgPerTonne: 97 },
      { ingredient: 'MCP', kgPerTonne: 10 },
      { ingredient: 'DLM', kgPerTonne: 2.2 },
      { ingredient: 'Lysine', kgPerTonne: 1.8 },
      { ingredient: 'Salt', kgPerTonne: 4 },
      { ingredient: 'Mixiblend', kgPerTonne: 5 },
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
  // A voucher's own rows carry the split as numbers, exactly as `financeRows` writes them.
  // Rows nobody classified stay unclassified: the finance view reports them as "Not recorded".
  { id: 'fx_1', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(2), kind: 'INCOME', amount: 31200, category: 'Egg Sale', counterparty: 'Rajesh Traders', refId: 'se_1', split: { cash: 26200, online: 5000 }, createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'fx_2', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(2), kind: 'EXPENSE', amount: 1200, category: 'Labour', counterparty: 'Rajesh Traders', refId: 'se_1', remarks: 'Loading labour for this sale', createdBy: 'u_finsup', createdAt: dBackISO(2), synced: true },
  { id: 'fx_3', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(1), kind: 'INCOME', amount: 10800, category: 'Egg Sale', counterparty: 'Meena Agencies', refId: 'se_2', paymentMethod: 'CASH', split: { cash: 10800 }, createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'fx_5', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(1), kind: 'EXPENSE', amount: 800, category: 'Labour', counterparty: 'Meena Agencies', refId: 'se_2', remarks: 'Loading labour for this sale', createdBy: 'u_finsup', createdAt: dBackISO(1), synced: true },
  { id: 'fx_10', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(4), kind: 'INCOME', amount: 10440, category: 'Egg Sale', counterparty: 'Suresh Wholesale', refId: 'se_3', split: { cash: 7200, online: 3240 }, createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
  { id: 'fx_11', companyId: 'c_amrut', batchId: 'b_gld2', date: dBack(4), kind: 'INCOME', amount: 6960, category: 'Egg Sale', counterparty: 'Suresh Wholesale', refId: 'se_3', split: { cash: 4800, online: 2160 }, createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
  { id: 'fx_12', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(4), kind: 'EXPENSE', amount: 360, category: 'Labour', counterparty: 'Suresh Wholesale', refId: 'se_3', remarks: 'Loading labour for this sale', createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
  { id: 'fx_13', companyId: 'c_amrut', batchId: 'b_gld2', date: dBack(4), kind: 'EXPENSE', amount: 240, category: 'Labour', counterparty: 'Suresh Wholesale', refId: 'se_3', remarks: 'Loading labour for this sale', createdBy: 'u_finsup', createdAt: dBackISO(4), synced: true },
  { id: 'fx_4', companyId: 'c_amrut', date: dBack(5), kind: 'EXPENSE', amount: 1250000, category: 'Feed Purchase', counterparty: 'Anand Feeds', purchaseId: 'fs_in_1', godown: true, createdBy: 'u_finsup', createdAt: dBackISO(5), synced: true },
  { id: 'fx_6', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(10), kind: 'EXPENSE', amount: 42000, category: 'Labour', createdBy: 'u_finsup', createdAt: dBackISO(10), synced: true },
  { id: 'fx_7', companyId: 'c_amrut', batchId: 'b_gld1', date: dBack(12), kind: 'EXPENSE', amount: 28000, category: 'Medicine', createdBy: 'u_finsup', createdAt: dBackISO(12), synced: true },
  // Part of what a medicine receipt is worth. It is inventory money: the receipt's ₹13,800
  // stands against it, the balance stays outstanding, and nothing here is a shed expense.
  { id: 'fx_14', companyId: 'c_amrut', date: dBack(8), kind: 'PAYMENT_OUT', amount: 8000, category: 'Medicine Purchase', counterparty: 'Poona Vet Suppliers', purchaseId: 'ms_in_enro', godown: true, paymentMethod: 'CASH', handedTo: 'Store counter, Poona Vet Suppliers', remarks: 'Part payment against MED receipt', createdBy: 'u_finsup', createdAt: dBackISO(8), synced: true },
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
