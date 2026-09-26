/**
 * tests/harness/fixtures.ts — the two-farm world every test starts from.
 *
 * It is invented, and deliberately so: nothing here is Amrut's production data, and no test
 * may reach for the live database instead. Two live companies and one shut down, one person
 * per role in the first, a flock each, and enough ledger behind them to make a wrong figure
 * visible. The numbers are chosen to be re-derivable by hand — ₹30 a kilo of maize, ₹130 a
 * packet, 60 trays at ₹6 an egg — because an assertion nobody can re-derive is a decoration.
 *
 * Two rules hold the world honest:
 *   - Only *primitive* records live here. A sale voucher, a feed consumption day and a
 *     medicine receipt each mint their own finance and ledger rows, so a test that needs one
 *     saves it through the store's own action. A hand-typed voucher would test a world the
 *     app cannot produce.
 *   - Every call returns fresh objects, so a test that mutates its fixture cannot reach into
 *     the next one's.
 */
import type {
  AuditEntry, Batch, BatchAssignment, CashCount, CashHandover, Company, EggCollection,
  EggSaleBooking, EggWastage, Farm, FarmTask, FeedConsumption, FeedFormula, FeedRoundLog,
  FeedStockEntry, FinanceTxn, MedicineItem, MedicineStockEntry, MortalityEntry, SaleEntry,
  SaleEntryDraft, SaleLog, Session, Shed, SupportMessage, Trader, TraderTxn, User,
  VaccinationItem, VaccinationTemplate,
} from '@/types';
import { EGGS_PER_TRAY } from '@/types';
import { hashPassword } from '@/lib/auth';
import { useApp } from '@/store/app';

/** The frozen farm day — `todayISO()` reads it, see tests/harness/register.mjs. */
export const DAY = '2026-02-15';
/** Yesterday: the only day with a full collection behind it. */
export const YESTERDAY = '2026-02-14';

export const PASSWORD = 'test1234';
export const PASSWORD_HASH = hashPassword(PASSWORD);

export const CO = { ALPHA: 'co_test_alpha', BETA: 'co_test_beta', CLOSED: 'co_test_closed' } as const;

export const U = {
  ALPHA_OWNER: 'u_test_alpha_owner',
  ALPHA_FINANCE: 'u_test_alpha_finance',
  ALPHA_FARM_SUP: 'u_test_alpha_farm_sup',
  ALPHA_FIN_SUP: 'u_test_alpha_fin_sup',
  ALPHA_MANAGER: 'u_test_alpha_manager',
  ALPHA_LABOR: 'u_test_alpha_labor',
  /** Cut off from the app while a session of theirs is still open. */
  ALPHA_EX: 'u_test_alpha_ex',
  BETA_OWNER: 'u_test_beta_owner',
  /** Holds both farms, so a company switch can be tested as one person. */
  BOTH_OWNER: 'u_test_both_owner',
  /** The only person belonging to the shut-down unit. */
  CLOSED_OWNER: 'u_test_closed_owner',
  PLATFORM: 'u_test_platform',
} as const;

export const FP = { ALPHA: 'fp_test_alpha', BETA: 'fp_test_beta', CLOSED: 'fp_test_closed' } as const;
export const SH = { A1: 'sh_test_a1', A2: 'sh_test_a2', B1: 'sh_test_b1', C1: 'sh_test_c1' } as const;
export const BT = { A1: 'bt_test_a1', A2: 'bt_test_a2', B1: 'bt_test_b1', C1: 'bt_test_c1' } as const;
export const TR = { A1: 'tr_test_a1', A2: 'tr_test_a2', B1: 'tr_test_b1' } as const;
export const MED = { OXY: 'md_test_oxy', RANIK: 'md_test_ranik' } as const;

/** Shed A1's flock was placed on New Year's Day, so `DAY` is its 45th flock day. */
export const BATCH_A1_PLACED = '2026-01-01';
export const BATCH_A1_DAY = 45;

/** Every hand-checkable figure in the world, in one place so a test quotes the same number. */
export const MONEY = {
  /** Maize: 5,000 kg at ₹28, then 5,000 kg at ₹32 → ₹30 the kilo; a 100 kg count shortage off that. */
  MAIZE_AVG: 30,
  MAIZE_KG: 10_000,
  MAIZE_BALANCE: 10_000 - 100,
  SOYA_AVG: 40,
  /** Shed A1's mash: 500 kg maize + 200 kg soya a tonne → ₹23,000 a tonne at those averages. */
  FORMULA_TONNE_COST: 500 * 30 + 200 * 40,
  /** Oxytetracycline: 20 packets at ₹120, then 20 at ₹140 → ₹130 a packet, 40 on the shelf. */
  OXY_AVG: 130,
  OXY_UNITS: 40,
  /** The voucher a money test mints: 60 good trays at ₹6 an egg, ₹500 loading, ₹5,000 cash. */
  EGGS_SOLD: 60 * EGGS_PER_TRAY,
  EGG_RATE: 6,
  EGGS_MONEY: 60 * EGGS_PER_TRAY * 6,
  LABOR: 500,
  BILLED: 60 * EGGS_PER_TRAY * 6 + 500,
  CASH_IN: 5_000,
  /** …which leaves ₹6,300 on the trader's account. */
  CREDIT: 60 * EGGS_PER_TRAY * 6 + 500 - 5_000,
} as const;

const AT = '2026-02-01T06:00:00.000Z';

function person(id: string, name: string, mobile: string, role: User['role'], companyIds: string[], active = true): User {
  return {
    id, name, mobile, passwordHash: PASSWORD_HASH, role, companyIds,
    initials: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    active, createdAt: AT, updatedAt: AT,
  };
}

/** Everything the store holds for the test world, in the store's own key names. */
export interface World {
  companies: Company[];
  users: User[];
  farms: Farm[];
  sheds: Shed[];
  batches: Batch[];
  assignments: BatchAssignment[];
  mortality: MortalityEntry[];
  feed: FeedConsumption[];
  feedRounds: FeedRoundLog[];
  eggs: EggCollection[];
  saleLogs: SaleLog[];
  saleEntries: SaleEntry[];
  /** Promised trays for the days ahead — a plan, never a ledger row. */
  eggSaleBookings: EggSaleBooking[];
  eggWastages: EggWastage[];
  feedStock: FeedStockEntry[];
  medicineItems: MedicineItem[];
  medicineStock: MedicineStockEntry[];
  feedFormulas: FeedFormula[];
  finance: FinanceTxn[];
  traders: Trader[];
  traderTxns: TraderTxn[];
  tasks: FarmTask[];
  vaccinations: VaccinationItem[];
  vaccinationTemplates: VaccinationTemplate[];
  ingredientCatalog: string[];
  supportMessages: SupportMessage[];
  cashHandovers: CashHandover[];
  cashCounts: CashCount[];
  audit: AuditEntry[];
  session: Session | null;
  accessNotice: null;
  toasts: [];
  online: boolean;
}

/** A fresh copy of the world. Call it per test; never share the result between two. */
export function buildWorld(overrides: Partial<World> = {}): World {
  return {
    companies: [
      { id: CO.ALPHA, name: 'Alpha Poultry Farms', active: true, createdAt: AT, updatedAt: AT },
      { id: CO.BETA, name: 'Beta Poultry Farms', active: true, createdAt: AT, updatedAt: AT },
      { id: CO.CLOSED, name: 'Closed Unit', active: false, createdAt: AT, updatedAt: AT },
    ],

    users: [
      person(U.ALPHA_OWNER, 'Alpha Owner', '9000000001', 'OWNER', [CO.ALPHA]),
      person(U.ALPHA_FINANCE, 'Alpha Accounts', '9000000002', 'FINANCIAL_SUPERVISOR', [CO.ALPHA]),
      person(U.ALPHA_FARM_SUP, 'Alpha Farm Supervisor', '9000000003', 'FARM_SUPERVISOR', [CO.ALPHA]),
      person(U.ALPHA_FIN_SUP, 'Alpha Finance Supervisor', '9000000004', 'FINANCIAL_SUPERVISOR', [CO.ALPHA]),
      person(U.ALPHA_MANAGER, 'Alpha Manager', '9000000005', 'FARM_MANAGER', [CO.ALPHA]),
      person(U.ALPHA_LABOR, 'Alpha Labor', '9000000006', 'FARM_LABOR', [CO.ALPHA]),
      person(U.ALPHA_EX, 'Alpha Left Team', '9000000009', 'FINANCIAL_SUPERVISOR', [CO.ALPHA], false),
      person(U.BETA_OWNER, 'Beta Owner', '9000000007', 'OWNER', [CO.BETA]),
      person(U.BOTH_OWNER, 'Both Farms Owner', '9000000010', 'OWNER', [CO.ALPHA, CO.BETA]),
      person(U.CLOSED_OWNER, 'Closed Unit Owner', '9000000011', 'OWNER', [CO.CLOSED]),
      person(U.PLATFORM, 'Platform Admin', '9000000008', 'MASTER_ADMIN', []),
    ],

    farms: [
      { id: FP.ALPHA, companyId: CO.ALPHA, name: 'Alpha Farm', location: 'Hyderabad', contactMobile: '9000000001', createdAt: AT, updatedAt: AT },
      { id: FP.BETA, companyId: CO.BETA, name: 'Beta Farm', location: 'Nashik', contactMobile: '9000000007', createdAt: AT, updatedAt: AT },
      { id: FP.CLOSED, companyId: CO.CLOSED, name: 'Closed Farm', location: 'Pune', contactMobile: '9000000011', createdAt: AT, updatedAt: AT },
    ],

    sheds: [
      { id: SH.A1, companyId: CO.ALPHA, farmId: FP.ALPHA, name: 'Shed A1', capacity: 1000, status: 'ACTIVE', farmSupervisorId: U.ALPHA_FARM_SUP, financialSupervisorId: U.ALPHA_FIN_SUP, createdAt: AT, updatedAt: AT },
      { id: SH.A2, companyId: CO.ALPHA, farmId: FP.ALPHA, name: 'Shed A2', capacity: 600, status: 'ACTIVE', createdAt: AT, updatedAt: AT },
      { id: SH.B1, companyId: CO.BETA, farmId: FP.BETA, name: 'Shed B1', capacity: 800, status: 'ACTIVE', createdAt: AT, updatedAt: AT },
      { id: SH.C1, companyId: CO.CLOSED, farmId: FP.CLOSED, name: 'Shed C1', capacity: 400, status: 'ACTIVE', createdAt: AT, updatedAt: AT },
    ],

    batches: [
      {
        id: BT.A1, companyId: CO.ALPHA, farmId: FP.ALPHA, shedId: SH.A1, code: 'A1-01',
        birdType: 'LAYER', breed: 'KH', hatchDate: '2025-12-20',
        placementDate: BATCH_A1_PLACED, startDate: BATCH_A1_PLACED, initialBirds: 1000,
        status: 'ACTIVE', approximateFeedTonnesPerDay: 0.12,
        managerId: U.ALPHA_MANAGER, supervisorId: U.ALPHA_FARM_SUP,
        createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT,
      },
      {
        id: BT.A2, companyId: CO.ALPHA, farmId: FP.ALPHA, shedId: SH.A2, code: 'A2-01',
        birdType: 'LAYER', breed: 'WB', hatchDate: '2025-12-01', placementDate: '2026-01-05',
        startDate: '2026-01-05', initialBirds: 600, status: 'ACTIVE',
        createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT,
      },
      {
        id: BT.B1, companyId: CO.BETA, farmId: FP.BETA, shedId: SH.B1, code: 'B-01',
        birdType: 'LAYER', breed: 'KH', hatchDate: '2025-11-20', placementDate: '2025-12-01',
        startDate: '2025-12-01', initialBirds: 800, status: 'ACTIVE',
        createdBy: U.BETA_OWNER, createdAt: AT, updatedAt: AT,
      },
      {
        id: BT.C1, companyId: CO.CLOSED, farmId: FP.CLOSED, shedId: SH.C1, code: 'C-01',
        birdType: 'LAYER', breed: 'KH', hatchDate: '2025-11-20', placementDate: '2025-12-01',
        startDate: '2025-12-01', initialBirds: 400, status: 'ACTIVE',
        createdBy: U.CLOSED_OWNER, createdAt: AT, updatedAt: AT,
      },
    ],

    assignments: [
      {
        id: 'ba_test_labor_a1', companyId: CO.ALPHA, batchId: BT.A1, userId: U.ALPHA_LABOR,
        role: 'FARM_LABOR',
        permissions: {
          create: false, createDailyOps: true, update: false, delete: false,
          viewFinance: false, viewRates: false, manageUsers: false, manageCompanies: false,
          manageTraders: false, manageFormulas: false, acknowledgeSales: false,
          createSaleEntries: false, closeBatch: false, exportReports: false,
          manageVaccination: false, completeVaccination: false,
        },
        assignedBy: U.ALPHA_OWNER, assignedAt: AT,
      },
    ],

    mortality: [
      { id: 'mo_test_a1', companyId: CO.ALPHA, batchId: BT.A1, shedId: SH.A1, date: '2026-02-10', count: 10, createdBy: U.ALPHA_LABOR, createdAt: AT, synced: true },
      { id: 'mo_test_b1', companyId: CO.BETA, batchId: BT.B1, shedId: SH.B1, date: '2026-02-10', count: 5, createdBy: U.BETA_OWNER, createdAt: AT, synced: true },
    ],

    feed: [],
    feedRounds: [],

    eggs: [
      { id: 'eg_test_a1_yday', companyId: CO.ALPHA, batchId: BT.A1, shedId: SH.A1, date: YESTERDAY, goodTrays: 100, brokenTrays: 20, doubleTrays: 10, smallTrays: 5, createdBy: U.ALPHA_LABOR, createdAt: AT, synced: true },
      { id: 'eg_test_a1_today', companyId: CO.ALPHA, batchId: BT.A1, shedId: SH.A1, date: DAY, goodTrays: 80, brokenTrays: 10, doubleTrays: 5, smallTrays: 0, createdBy: U.ALPHA_LABOR, createdAt: AT, synced: true },
      { id: 'eg_test_a2_today', companyId: CO.ALPHA, batchId: BT.A2, shedId: SH.A2, date: DAY, goodTrays: 20, brokenTrays: 0, doubleTrays: 0, smallTrays: 0, createdBy: U.ALPHA_LABOR, createdAt: AT, synced: true },
      { id: 'eg_test_b1_today', companyId: CO.BETA, batchId: BT.B1, shedId: SH.B1, date: DAY, goodTrays: 15, brokenTrays: 3, doubleTrays: 0, smallTrays: 0, createdBy: U.BETA_OWNER, createdAt: AT, synced: true },
      { id: 'eg_test_c1_today', companyId: CO.CLOSED, batchId: BT.C1, shedId: SH.C1, date: DAY, goodTrays: 12, brokenTrays: 0, doubleTrays: 0, smallTrays: 0, createdBy: U.CLOSED_OWNER, createdAt: AT, synced: true },
    ],

    saleLogs: [],
    saleEntries: [],

    eggSaleBookings: [
      {
        id: 'bk_test_a1', companyId: CO.ALPHA, shedId: SH.A1, batchId: BT.A1, date: '2026-02-17',
        traderId: TR.A1, plannedTrays: 30, grade: 'GOOD', status: 'PLANNED',
        createdBy: U.ALPHA_MANAGER, createdAt: AT, synced: true,
      },
    ],

    eggWastages: [
      {
        id: 'ew_test_a1', companyId: CO.ALPHA, batchId: BT.A1, shedId: SH.A1, date: YESTERDAY,
        byGrade: { GOOD: 0, BROKEN: 5, DOUBLE: 0, SMALL: 0 },
        reason: 'Cracked in handling', createdBy: U.ALPHA_MANAGER, createdAt: AT, synced: true,
      },
    ],

    feedStock: [
      { id: 'fs_test_maize_open', companyId: CO.ALPHA, ingredient: 'Maize', date: '2026-02-01', kind: 'OPENING', qtyKg: 5000, ratePerKg: 28, supplier: 'Alpha Feeds', createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'fs_test_maize_in', companyId: CO.ALPHA, ingredient: 'Maize', date: '2026-02-10', kind: 'FEED_IN', qtyKg: 5000, ratePerKg: 32, supplier: 'Alpha Feeds', purchaseRef: 'PUR-2026-02-10-001', createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'fs_test_soya_open', companyId: CO.ALPHA, ingredient: 'Soya DOC', date: '2026-02-01', kind: 'OPENING', qtyKg: 2000, ratePerKg: 40, supplier: 'Alpha Feeds', createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'fs_test_shortage', companyId: CO.ALPHA, ingredient: 'Maize', date: '2026-02-12', kind: 'SHORTAGE', qtyKg: -100, remarks: 'Count came up short', createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'fs_test_beta_open', companyId: CO.BETA, ingredient: 'Maize', date: '2026-02-01', kind: 'OPENING', qtyKg: 900, ratePerKg: 27, supplier: 'Beta Feeds', createdBy: U.BETA_OWNER, createdAt: AT, synced: true },
    ],

    medicineItems: [
      { id: MED.OXY, companyId: CO.ALPHA, name: 'Oxytetracycline', category: 'MEDICINE', unit: 'packet', active: true, lowStockThreshold: 5, specifications: '100 g', createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT },
      { id: MED.RANIK, companyId: CO.ALPHA, name: 'Ranik Vaccine', category: 'VACCINE', unit: 'vial', active: true, lowStockThreshold: 10, createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT },
    ],

    medicineStock: [
      { id: 'ms_test_oxy_open', companyId: CO.ALPHA, medicineId: MED.OXY, date: '2026-02-01', kind: 'OPENING', qty: 20, ratePerUnit: 120, createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'ms_test_oxy_in', companyId: CO.ALPHA, medicineId: MED.OXY, date: '2026-02-10', kind: 'RECEIPT', qty: 20, ratePerUnit: 140, supplier: 'Alpha Vet', purchaseRef: 'MED-2026-02-10-001', lotNumber: 'L-1', expiryDate: '2026-12-31', createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'ms_test_ranik_open', companyId: CO.ALPHA, medicineId: MED.RANIK, date: '2026-02-01', kind: 'OPENING', qty: 50, ratePerUnit: 30, createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
    ],

    feedFormulas: [
      {
        id: 'ff_test_a1', companyId: CO.ALPHA, shedId: SH.A1, name: 'A1 Layer Mash', familyId: 'ff_test_a1',
        version: 1, effectiveFrom: BATCH_A1_PLACED, status: 'ACTIVE',
        items: [{ ingredient: 'Maize', kgPerTonne: 500 }, { ingredient: 'Soya DOC', kgPerTonne: 200 }],
        createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT,
      },
    ],

    finance: [
      { id: 'ft_test_income', companyId: CO.ALPHA, batchId: BT.A1, date: '2026-02-12', kind: 'INCOME', amount: 1000, category: 'Other Income', counterparty: 'Spare birds buyer', paymentMethod: 'CASH', createdBy: U.ALPHA_FINANCE, createdAt: AT, synced: true },
      { id: 'ft_test_labour', companyId: CO.ALPHA, batchId: BT.A1, date: '2026-02-13', kind: 'EXPENSE', amount: 2000, category: 'Labour', counterparty: 'Daily wages', paymentMethod: 'CASH', createdBy: U.ALPHA_FINANCE, createdAt: AT, synced: true },
      { id: 'ft_test_feed_pay', companyId: CO.ALPHA, godown: true, date: '2026-02-11', kind: 'PURCHASE', amount: 4000, category: 'Feed Purchase', counterparty: 'Alpha Feeds', purchaseId: 'fs_test_maize_in', paymentMethod: 'CASH', createdBy: U.ALPHA_FINANCE, createdAt: AT, synced: true },
      { id: 'ft_test_beta_income', companyId: CO.BETA, batchId: BT.B1, date: '2026-02-12', kind: 'INCOME', amount: 700, category: 'Other Income', paymentMethod: 'CASH', createdBy: U.BETA_OWNER, createdAt: AT, synced: true },
    ],

    traders: [
      { id: TR.A1, companyId: CO.ALPHA, name: 'Venky Egg Mart', mobile: '9111111111', openingBalance: 0, outstandingAmount: 0, active: true, createdAt: AT, updatedAt: AT },
      { id: TR.A2, companyId: CO.ALPHA, name: 'Sai Traders', mobile: '9222222222', openingBalance: 5000, outstandingAmount: 5000, active: true, createdAt: AT, updatedAt: AT },
      { id: TR.B1, companyId: CO.BETA, name: 'Beta Buyer', mobile: '9333333333', openingBalance: 1500, outstandingAmount: 1500, active: true, createdAt: AT, updatedAt: AT },
    ],

    traderTxns: [
      { id: 'tt_test_a2_open', companyId: CO.ALPHA, traderId: TR.A2, date: '2026-02-01', kind: 'OPENING', amount: 5000, createdBy: U.ALPHA_OWNER, createdAt: AT, synced: true },
      { id: 'tt_test_beta_open', companyId: CO.BETA, traderId: TR.B1, date: '2026-02-01', kind: 'OPENING', amount: 1500, createdBy: U.BETA_OWNER, createdAt: AT, synced: true },
    ],

    tasks: [
      { id: 'tk_test_1', companyId: CO.ALPHA, title: 'Clean the water lines', date: DAY, assignedUserId: U.ALPHA_LABOR, farmId: FP.ALPHA, shedId: SH.A1, batchId: BT.A1, priority: 'MEDIUM', status: 'PENDING', createdBy: U.ALPHA_MANAGER, createdAt: AT, updatedAt: AT, synced: true },
    ],

    vaccinations: [
      {
        id: 'vc_test_a1', companyId: CO.ALPHA, batchId: BT.A1, shedId: SH.A1, relativeDay: BATCH_A1_DAY,
        vaccineName: 'Fowl Pox', scheduledDate: DAY, reminderDaysBefore: 2, dose: '0.5 ml', route: 'Wing web',
        status: 'SCHEDULED', createdBy: U.ALPHA_OWNER, createdAt: AT, updatedAt: AT, synced: true,
      },
    ],

    vaccinationTemplates: [],
    ingredientCatalog: ['Maize', 'Soya DOC', 'Stone', 'Salt'],
    supportMessages: [],
    cashHandovers: [],
    cashCounts: [],
    audit: [],

    session: null,
    accessNotice: null,
    toasts: [],
    online: true,

    ...overrides,
  };
}

/** A signed-in session for one person, in one company. */
export function sessionFor(userId: string, companyId: string | null = CO.ALPHA): Session {
  return { userId, companyId, signedInAt: AT };
}

/** The world with a working context already in it — the shape nearly every test starts from. */
export function worldAs(userId: string, companyId: string | null = CO.ALPHA, overrides: Partial<World> = {}): World {
  return buildWorld({ session: sessionFor(userId, companyId), ...overrides });
}

/**
 * Replace the store's whole state with a world. The seeded demo company never reaches a
 * test, and one test's writes never reach the next — Zustand's `setState` is a merge, so
 * every collection the world names is replaced, not appended to.
 */
export function resetApp(world: World = buildWorld()) {
  useApp.setState(world);
  return useApp.getState();
}

/** The store's own session helpers, so a test signs in the way the app does. */
export function signInAs(userId: string, companyId: string | null = CO.ALPHA) {
  useApp.setState({ session: sessionFor(userId, companyId), accessNotice: null });
  return useApp.getState();
}

/** The login number of a fixture person — sign-in is addressed by mobile, never by id. */
export function mobileOf(world: World, userId: string): string {
  const u = world.users.find(x => x.id === userId);
  if (!u) throw new Error(`No fixture user ${userId}`);
  return u.mobile;
}

/** The world as it reads after the pull said this person left, or was switched off. */
export function worldWithUser(world: World, userId: string, patch: Partial<User>): World {
  return { ...world, users: world.users.map(u => (u.id === userId ? { ...u, ...patch } : u)) };
}

/** The world as it reads after a company was switched off, or its name changed. */
export function worldWithCompany(world: World, companyId: string, patch: Partial<Company>): World {
  return { ...world, companies: world.companies.map(c => (c.id === companyId ? { ...c, ...patch } : c)) };
}

/**
 * The voucher a money test mints, in the same rupees the `MONEY` block describes.
 * Saved through `addSaleEntry`, which is what makes the trader's ledger and the finance
 * rows agree with it — this object is only what the form would have supplied.
 */
export function alphaSaleDraft(over: Partial<SaleEntryDraft> = {}): SaleEntryDraft {
  return {
    traderId: TR.A1,
    date: DAY,
    lines: [{ shedId: SH.A1, byGrade: { GOOD: 60, BROKEN: 0, DOUBLE: 0, SMALL: 0 } }],
    rates: { GOOD: MONEY.EGG_RATE },
    pricing: 'RATE',
    cash: MONEY.CASH_IN,
    phonepe: 0,
    advance: 0,
    // Cash names the person who physically took it; the voucher's `createdBy` is whoever typed it.
    cashHandledById: U.ALPHA_FINANCE,
    cashTime: '09:15',
    laborCharge: MONEY.LABOR,
    remarks: 'Morning load',
    ...over,
  };
}
