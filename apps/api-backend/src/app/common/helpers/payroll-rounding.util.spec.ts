import { roundToNearestRupee } from './payroll-rounding.util';

describe('roundToNearestRupee', () => {
  it('never touches values that are already whole', () => {
    expect(roundToNearestRupee(0)).toBe(0);
    expect(roundToNearestRupee(5)).toBe(5);
    expect(roundToNearestRupee(-5)).toBe(-5);
    expect(roundToNearestRupee(100000)).toBe(100000);
  });

  it('rounds .5 up (round-half-up, matching Math.round)', () => {
    expect(roundToNearestRupee(0.5)).toBe(1);
    expect(roundToNearestRupee(1.5)).toBe(2);
    expect(roundToNearestRupee(2.5)).toBe(3);
    expect(roundToNearestRupee(99.5)).toBe(100);
  });

  it('rounds negative halves the same way Math.round does (toward +Infinity, not away from zero)', () => {
    expect(roundToNearestRupee(-1.5)).toBe(-1);
    expect(roundToNearestRupee(-2.5)).toBe(-2);
  });

  it('rounds non-half fractional values to the nearest integer', () => {
    expect(roundToNearestRupee(2.4)).toBe(2);
    expect(roundToNearestRupee(2.6)).toBe(3);
    expect(roundToNearestRupee(-2.4)).toBe(-2);
    expect(roundToNearestRupee(-2.6)).toBe(-3);
  });

  it('throws a RangeError for non-finite input', () => {
    expect(() => roundToNearestRupee(NaN)).toThrow(RangeError);
    expect(() => roundToNearestRupee(Infinity)).toThrow(RangeError);
    expect(() => roundToNearestRupee(-Infinity)).toThrow(RangeError);
  });
});
