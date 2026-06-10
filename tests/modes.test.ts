import { describe, expect, it } from 'vitest';
import { ModeStack, routeSpace, type SpaceContext } from '../src/input/modes';

/** M3 design note 5 / risk 4: the mode stack gates SPACE — the swing path
 * stays clean (fence 1) and INITIALS/ESC input can never reach queueSwing. */

function ctx(over: Partial<SpaceContext>): SpaceContext {
  return {
    mode: 'PLAY',
    paused: false,
    inRound: true,
    station: 'PLAY',
    panelFocusTier: 40,
    selectedTier: 40,
    ...over,
  };
}

describe('routeSpace', () => {
  it('in a live round, SPACE is THE swing — nothing else', () => {
    expect(routeSpace(ctx({}))).toBe('SWING');
    // Even standing at another station mid-round (camera can't be there, but
    // the gate must not care).
    expect(routeSpace(ctx({ station: 'MONITOR' }))).toBe('SWING');
  });

  it('SPACE during INITIALS never reaches queueSwing', () => {
    expect(routeSpace(ctx({ mode: 'INITIALS' }))).toBe('INITIALS_CONFIRM');
    expect(routeSpace(ctx({ mode: 'INITIALS', inRound: false }))).toBe('INITIALS_CONFIRM');
  });

  it('SPACE while the ESC sheet is open (or paused) does nothing', () => {
    expect(routeSpace(ctx({ mode: 'ESC' }))).toBe('NONE');
    expect(routeSpace(ctx({ paused: true }))).toBe('NONE');
    expect(routeSpace(ctx({ mode: 'ESC', inRound: false }))).toBe('NONE');
  });

  it('at the panel with an unconfirmed focus, SPACE confirms the tier', () => {
    expect(routeSpace(ctx({ inRound: false, station: 'PANEL', panelFocusTier: 60, selectedTier: 40 }))).toBe(
      'PANEL_CONFIRM'
    );
  });

  it('idle SPACE inserts a token — the one-key hot-seat re-token (§14.13)', () => {
    expect(routeSpace(ctx({ inRound: false }))).toBe('TOKEN');
    // At the panel with the loadout already selected, one press proceeds (§Flow 2).
    expect(routeSpace(ctx({ inRound: false, station: 'PANEL', panelFocusTier: 40, selectedTier: 40 }))).toBe('TOKEN');
    expect(routeSpace(ctx({ inRound: false, station: 'MONITOR' }))).toBe('TOKEN');
  });
});

describe('ModeStack', () => {
  it('pushes and pops with the PLAY floor', () => {
    const m = new ModeStack();
    expect(m.mode).toBe('PLAY');
    m.push('INITIALS');
    expect(m.mode).toBe('INITIALS');
    m.push('ESC');
    expect(m.mode).toBe('ESC');
    m.pop('ESC');
    expect(m.mode).toBe('INITIALS');
    m.pop('INITIALS');
    expect(m.mode).toBe('PLAY');
    m.pop(); // floor holds
    expect(m.mode).toBe('PLAY');
  });

  it('expected-mode pop is a no-op on mismatch; duplicate push collapses', () => {
    const m = new ModeStack();
    m.push('INITIALS');
    m.pop('ESC'); // wrong expectation — nothing happens
    expect(m.mode).toBe('INITIALS');
    m.push('INITIALS');
    m.pop('INITIALS');
    expect(m.mode).toBe('PLAY');
    m.push('ESC');
    m.reset();
    expect(m.mode).toBe('PLAY');
  });
});
