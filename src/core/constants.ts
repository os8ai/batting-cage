import type { TierMph } from './types';

// ---------------------------------------------------------------------------
// Unit conversions. Internals are SI (meters, seconds, radians); every
// player-facing number is imperial (SPEC §"Detailed design" preamble).
// ---------------------------------------------------------------------------
export const MPH_TO_MPS = 0.44704;
export const MPS_TO_MPH = 1 / MPH_TO_MPS;
export const FT_TO_M = 0.3048;
export const M_TO_FT = 1 / FT_TO_M;
export const DEG_TO_RAD = Math.PI / 180;
export const RPM_TO_RADS = (2 * Math.PI) / 60;

// ---------------------------------------------------------------------------
// Ball & air (SPEC §7 constants table). Cd/Cl are TUNABLE within the §7
// calibration tolerance (±10 ft on every table row) — the table is the
// contract, not these values. Cd below was tuned against the table.
// ---------------------------------------------------------------------------
export const BALL_MASS_KG = 0.145;
export const BALL_RADIUS_M = 0.0366;
export const BALL_AREA_M2 = Math.PI * BALL_RADIUS_M * BALL_RADIUS_M; // 4.207e-3
export const AIR_RHO = 1.205;
export const GRAVITY = 9.81;
export const DRAG_CD = 0.4; // TUNABLE (calibrated vs §7 table; spec launch value 0.33)
export const LIFT_CL_MAX = 0.35; // TUNABLE
export const LIFT_CL_SLOPE = 1.5; // TUNABLE
/** ρ·Cd·A / 2m — precomputed drag factor. */
export const DRAG_K = (AIR_RHO * DRAG_CD * BALL_AREA_M2) / (2 * BALL_MASS_KG);
/** ρ·A / 2m — Magnus prefactor (× Cl × |v|²). */
export const MAGNUS_K = (AIR_RHO * BALL_AREA_M2) / (2 * BALL_MASS_KG);

/** Batted backspin: 500 + 60×LA° rpm, min 300 (§7). No sidespin in v1. */
export const SPIN_BASE_RPM = 500;
export const SPIN_PER_LA_DEG = 60;
export const SPIN_MIN_RPM = 300;

// ---------------------------------------------------------------------------
// Cage geometry (SPEC §4). Origin = rear point of home plate at floor level;
// +Z toward the machine, +Y up. The engine is right-handed, so +X is the
// third-base / left-field side (§4's "+X = right field" assumed a left-handed
// frame); right field is −X. Facing the machine, +X appears screen-left.
// ---------------------------------------------------------------------------
export const RELEASE_DIST_M = 46.0 * FT_TO_M; // 14.0208 — release aperture from plate
export const RELEASE_HEIGHT_M = 3.5 * FT_TO_M; // 1.0668
export const PLATE_CROSS_HEIGHT_M = 2.5 * FT_TO_M; // 0.762 — every tier (§5)
export const MACHINE_BODY_DIST_M = 47.5 * FT_TO_M;

export const CAGE_HALF_WIDTH_M = 7.0 * FT_TO_M; // 14 ft wide
export const CAGE_HEIGHT_M = 12.0 * FT_TO_M;
export const CAGE_BACK_Z_M = -8.0 * FT_TO_M; // back net (plate 8 ft from it)
export const CAGE_FAR_Z_M = 62.0 * FT_TO_M; // 70 ft tunnel minus the 8 ft behind plate

export const BACKSTOP_Z_M = -4.0 * FT_TO_M; // pad 4 ft behind plate
export const BACKSTOP_HALF_WIDTH_M = 4.0 * FT_TO_M; // 8 ft wide
export const BACKSTOP_HEIGHT_M = 7.0 * FT_TO_M;

// ---------------------------------------------------------------------------
// In-cage collision response (SPEC §7, visual/never scored; basic version in
// M0, polish in M2).
// ---------------------------------------------------------------------------
export const NET_CATCH_DAMP = 0.15; // ball velocity damps to ~15% on net catch
export const E_TURF = 0.38;
export const E_BACKSTOP = 0.1;
export const E_FRAME = 0.45;
export const E_GUARD = 0.3;
export const SLEEP_SPEED_MPS = 0.3;
export const TURF_ROLL_DECAY = 1.8; // s⁻¹ exponential horizontal decay while rolling
export const SETTLED_POOL = 12;

// Steel-frame uprights (§4: every 10 ft along both side nets) — narrow
// cylinder colliders, so a clang is rare by design (M2-PLAN §4 P0).
export const FRAME_RADIUS_M = 0.032;
export const FRAME_FIRST_Z_M = -8.0 * FT_TO_M;
export const FRAME_SPACING_M = 10.0 * FT_TO_M;
export const FRAME_LAST_Z_M = 62.0 * FT_TO_M;
// Machine guard AABB (§4 steel mesh guard; matches the M1 prop: 0.75 m half
// extent around the machine body, posts to 1.9 m). Active for batted balls
// only — the pitched ball exits through the guard's aperture.
export const GUARD_HALF_XZ_M = 0.75;
export const GUARD_TOP_M = 1.9;
/** Turf bounces below this vertical impact speed stay silent (no BALL_BOUNCE). */
export const BOUNCE_EVENT_MIN_VY_MPS = 2.0;

// ---------------------------------------------------------------------------
// Verlet cloth (SPEC §11; M2). Visual-only physics — presentation steps it;
// the sim never reads it. All TUNABLE within the M2 exit checks (believable
// reaction across the EV range, no instability at a 102 EV impulse).
// ---------------------------------------------------------------------------
export const CLOTH_HZ = 60;
export const CLOTH_DT = 1 / CLOTH_HZ;
export const CLOTH_SUBSTEPS = 2;
export const CLOTH_CONSTRAINT_PASSES = 2;
export const CLOTH_DAMPING = 0.02; // per-substep velocity damping (air)
export const CLOTH_NODE_PITCH_M = 0.35; // wall panels (§11 "node pitch ~0.35 m")
export const CLOTH_CEILING_PITCH_M = 0.5; // ceiling strip, coarser
/** Injected node velocity is clamped so a 102 EV rope deforms ~0.5–0.7 m
 * without tunneling (M2-PLAN §3.4; solver proven stable at 50 m/s headless). */
export const CLOTH_IMPULSE_MAX_MPS = 34;
/** settleEnergy below this = panel at rest (normals recompute can skip). */
export const CLOTH_REST_ENERGY = 2e-5;

// ---------------------------------------------------------------------------
// The pitch clock (SPEC §5): one fixed 7.5 s cycle, every tier, no jitter.
// ---------------------------------------------------------------------------
export const CYCLE_S = 7.5;
export const FEED_T = 0.0;
export const LOAD_T = 0.9;
export const RELEASE_T = 1.8; // the timing anchor — status light snaps green
export const BOARD_AFTER_PLATE_S = 0.6; // swing card reveals 0.6 s after the plate moment
export const BOARD_HOLD_S = 1.5;
export const ARMED_T = 5.5;
export const SPINUP_S = 3.0; // token insert → first FEED
export const PITCHES_PER_ROUND = 10;

// ---------------------------------------------------------------------------
// Swing & contact model (SPEC §6).
// ---------------------------------------------------------------------------
/** Swing animation reaches contact exactly K after SPACE keydown. */
export const SWING_CONTACT_OFFSET_S = 0.15;
/** Input accepted from RELEASE until plate + grace. */
export const GRACE_S = 0.2;

export const TIERS: readonly TierMph[] = [40, 50, 60, 70, 80, 90];

/** Per-tier grade windows, |ε| ms (§6, TUNABLE — launch values). */
export const WINDOWS_MS: Record<TierMph, { P: number; GR: number; GD: number; FL: number }> = {
  40: { P: 40, GR: 80, GD: 120, FL: 160 },
  50: { P: 35, GR: 70, GD: 105, FL: 145 },
  60: { P: 30, GR: 60, GD: 90, FL: 130 },
  70: { P: 25, GR: 50, GD: 75, FL: 115 },
  80: { P: 20, GR: 40, GD: 60, FL: 100 },
  90: { P: 15, GR: 30, GD: 45, FL: 85 },
};

/** Contact-quality anchors: q(0)→q(W_P)→q(W_GR)→q(W_GD), piecewise linear (§6). */
export const Q_ANCHORS = { q0: 1.0, qP: 0.95, qGR: 0.82, qGD: 0.65 } as const;
/** Foul-band q extends the GR→GD slope, clamped (TUNABLE; spec leaves foul q open). */
export const Q_FOUL_MIN = 0.4;

export const BAT_SPEED_MPH = 70; // constant, wood and metal identical (§6)
export const EV_BAT_FACTOR = 1.2;
export const EV_PITCH_FACTOR = 0.2;
export const EV_JITTER = 0.02; // jitter ∈ [0.98, 1.02], seeded

export const LA_BASE_DEG = 25;
export const LA_SLOPE_DEG = 21; // × u, u = ε/W_GD
export const LA_JITTER_DEG = 3;
export const LA_MIN_DEG = -5;
export const LA_MAX_DEG = 55;

export const SPRAY_FAIR_MAX_DEG = 40; // |ε| ≤ W_GD maps linearly 0→40°
export const SPRAY_FOUL_MIN_DEG = 46; // FOUL band maps (W_GD, W_FL] → 46°→70°
export const SPRAY_FOUL_MAX_DEG = 70;
export const SPRAY_JITTER_DEG = 2; // cannot flip fair/foul across the 6° guard gap
export const SPRAY_CENTER_TAG_DEG = 8; // |φ| ≤ 8° CENTER, else PULL / OPPO

// ---------------------------------------------------------------------------
// Scoring & progression tables (SPEC §8). Stored at the single source now;
// consumed by rules/scoring.ts & rules/progression.ts in M3.
// ---------------------------------------------------------------------------
export const POINT_MULTIPLIERS = { PERFECT: 1.6, GREAT: 1.25, GOOD: 1.0 } as const;
export const FOUL_POINTS = 25;

export const MEDAL_THRESHOLDS: Record<
  TierMph,
  { bronze: number; silver: number; gold: number; platinum: number; platinumCarryFt: number }
> = {
  40: { bronze: 1800, silver: 3200, gold: 4600, platinum: 5800, platinumCarryFt: 2800 },
  50: { bronze: 1900, silver: 3400, gold: 4900, platinum: 6100, platinumCarryFt: 2950 },
  60: { bronze: 2000, silver: 3600, gold: 5200, platinum: 6400, platinumCarryFt: 3100 },
  70: { bronze: 2100, silver: 3800, gold: 5500, platinum: 6800, platinumCarryFt: 3300 },
  80: { bronze: 2200, silver: 4000, gold: 5800, platinum: 7100, platinumCarryFt: 3450 },
  90: { bronze: 2300, silver: 4200, gold: 6100, platinum: 7500, platinumCarryFt: 3600 },
};

export const DISTANCE_CLUBS_FT = [250, 300, 350, 400] as const;

// ---------------------------------------------------------------------------
// Sim rates (SPEC §Architecture / §7).
// ---------------------------------------------------------------------------
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
export const PROJECTION_HZ = 240;
export const PROJECTION_DT = 1 / PROJECTION_HZ;
