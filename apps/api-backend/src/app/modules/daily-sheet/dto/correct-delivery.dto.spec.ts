import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CorrectDeliveryDto } from './correct-delivery.dto';

/**
 * Unit tests: CorrectDeliveryDto (class-validator).
 *
 * Edit Closed-Sheet Delivery payload. The four counts are `@IsInt @Min(0)` and
 * required; `priceOverride` is `@IsNumber @Min(0) @IsOptional`; `correctionNote`
 * is ALWAYS required — `@Transform` trim + `@IsString @MinLength(3)
 * @MaxLength(500)` (same style as void-delivery.dto.spec.ts).
 */
const props = (errs: Awaited<ReturnType<typeof validate>>) => errs.map((e) => e.property);

const base = {
  filledDropped: 6,
  emptyReceived: 4,
  filledReceived: 0,
  cashCollected: 600,
  correctionNote: 'driver logged 5/500, actually 6/600',
};

describe('CorrectDeliveryDto validation', () => {
  it('accepts four non-negative ints + a valid correctionNote (no priceOverride)', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts an optional priceOverride', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, priceOverride: 120.5 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing correctionNote', async () => {
    const { correctionNote, ...rest } = base;
    void correctionNote;
    const dto = plainToInstance(CorrectDeliveryDto, rest);
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a 2-char correctionNote (below MinLength 3)', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, correctionNote: 'ab' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a whitespace-only correctionNote (trimmed to empty)', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, correctionNote: '   ' });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a correctionNote longer than 500 chars', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, correctionNote: 'x'.repeat(501) });
    expect(props(await validate(dto))).toContain('correctionNote');
  });

  it('rejects a negative count (cashCollected: -1)', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, cashCollected: -1 });
    expect(props(await validate(dto))).toContain('cashCollected');
  });

  it('rejects a non-integer count (filledDropped: 1.5)', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, filledDropped: 1.5 });
    expect(props(await validate(dto))).toContain('filledDropped');
  });

  it('rejects a negative priceOverride', async () => {
    const dto = plainToInstance(CorrectDeliveryDto, { ...base, priceOverride: -5 });
    expect(props(await validate(dto))).toContain('priceOverride');
  });
});
