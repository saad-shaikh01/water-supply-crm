import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CorrectClosedExpenseDto } from './correct-closed-expense.dto';

/**
 * Unit tests: CorrectClosedExpenseDto (class-validator).
 *
 * Every mutable field is optional (partial update); `correctionNote` is ALWAYS
 * required — `@IsString @MinLength(3) @MaxLength(500)` with a `@Transform` trim
 * so a whitespace-only note collapses to "" and is rejected. Mirrors the
 * note-validation style of correct-closed-trip.dto.spec.ts.
 */
const props = (errs: Awaited<ReturnType<typeof validate>>) => errs.map((e) => e.property);

describe('CorrectClosedExpenseDto validation', () => {
  it('accepts a lone valid correctionNote (all other fields omitted)', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { correctionNote: 'fix the amount' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a full valid payload', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, {
      amount: 750,
      category: 'OTHER',
      description: 'corrected tea',
      date: '2026-08-17',
      paidFromCash: false,
      correctionNote: 'driver logged 500, actually 750',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing correctionNote', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { amount: 750 });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a blank correctionNote', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { correctionNote: '' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a whitespace-only correctionNote (trimmed to "" then < 3)', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { correctionNote: '    ' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a correctionNote shorter than 3 chars', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { correctionNote: 'ab' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a correctionNote longer than 500 chars', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { correctionNote: 'x'.repeat(501) });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects amount below 0.01', async () => {
    const dto = plainToInstance(CorrectClosedExpenseDto, { amount: 0, correctionNote: 'valid note' });
    expect(props(await validate(dto))).toContain('amount');
  });
});
