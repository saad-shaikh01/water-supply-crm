import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CorrectClosedTripDto } from './correct-closed-trip.dto';

/**
 * Unit tests: CorrectClosedTripDto (class-validator).
 *
 * Post-Close Trip Correction payload. The four physical counts are
 * `@IsInt @Min(0)` (copied from CheckinLoadDto minus `forceResubmit`).
 * `correctionNote` is ALWAYS required (no `@ValidateIf`) — `@IsString`
 * `@MinLength(3)` `@MaxLength(500)` with a `@Transform` trim so a
 * whitespace-only note collapses to "" and is rejected. Mirrors the
 * note-validation style of void-delivery.dto.spec.ts.
 */
const props = (errs: Awaited<ReturnType<typeof validate>>) =>
  errs.map((e) => e.property);

const base = {
  returnedFilled: 5,
  collectedEmpty: 3,
  damagedOnVan: 1,
  leakedOnVan: 0,
  correctionNote: 'fixed count',
};

describe('CorrectClosedTripDto validation', () => {
  it('accepts four non-negative ints + a valid correctionNote', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts all-zero counts with a valid note', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, {
      returnedFilled: 0,
      collectedEmpty: 0,
      damagedOnVan: 0,
      leakedOnVan: 0,
      correctionNote: 'zeroed out after recount',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing correctionNote', async () => {
    const { correctionNote, ...rest } = base;
    void correctionNote;
    const dto = plainToInstance(CorrectClosedTripDto, rest);
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a 2-char correctionNote (below MinLength 3)', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base, correctionNote: 'ab' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a whitespace-only correctionNote (trimmed to empty)', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base, correctionNote: '   ' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('accepts a 3-char correctionNote', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base, correctionNote: 'abc' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a correctionNote longer than 500 chars', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, {
      ...base,
      correctionNote: 'x'.repeat(501),
    });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a negative count (returnedFilled: -1)', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base, returnedFilled: -1 });
    expect(props(await validate(dto))).toContain('returnedFilled');
  });

  it('rejects a non-integer count (collectedEmpty: 1.5)', async () => {
    const dto = plainToInstance(CorrectClosedTripDto, { ...base, collectedEmpty: 1.5 });
    expect(props(await validate(dto))).toContain('collectedEmpty');
  });

  it('rejects a missing count field (damagedOnVan absent)', async () => {
    const { damagedOnVan, ...rest } = base;
    void damagedOnVan;
    const dto = plainToInstance(CorrectClosedTripDto, rest);
    expect(props(await validate(dto))).toContain('damagedOnVan');
  });
});
