import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DeliveryVoidReason } from '@prisma/client';
import { VoidDeliveryDto } from './void-delivery.dto';

/**
 * Unit tests: VoidDeliveryDto (class-validator).
 *
 * `voidReason` is always required. `voidNote` is mandatory (min 3 chars) only
 * when `voidReason === 'OTHER'`; for any other structured reason it is optional
 * but still length-checked (3–500) when supplied. Mirrors the note-validation
 * style of EditPaymentDto / AddCorrectionItemDto.
 */
const props = (errs: Awaited<ReturnType<typeof validate>>) =>
  errs.map((e) => e.property);

describe('VoidDeliveryDto validation', () => {
  it('accepts a known structured reason with no note', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.DUPLICATE,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts every non-OTHER structured reason with no note', async () => {
    for (const reason of [
      DeliveryVoidReason.DUPLICATE,
      DeliveryVoidReason.WRONG_SHEET,
      DeliveryVoidReason.WRONG_DATE,
      DeliveryVoidReason.NEVER_HAPPENED,
      DeliveryVoidReason.DATA_ENTRY_ERROR,
    ]) {
      const dto = plainToInstance(VoidDeliveryDto, { voidReason: reason });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects a missing voidReason', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {});
    expect(props(await validate(dto))).toContain('voidReason');
  });

  it('rejects an unknown reason string', async () => {
    const dto = plainToInstance(VoidDeliveryDto, { voidReason: 'NOT_A_REAL_REASON' });
    expect(props(await validate(dto))).toContain('voidReason');
  });

  it('rejects reason OTHER with no note', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.OTHER,
    });
    expect(props(await validate(dto))).toContain('voidNote');
  });

  it('rejects reason OTHER with a 2-char note (below MinLength 3)', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.OTHER,
      voidNote: 'ab',
    });
    expect(props(await validate(dto))).toContain('voidNote');
  });

  it('accepts reason OTHER with a 3-char note', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.OTHER,
      voidNote: 'abc',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a note longer than 500 chars (even for a non-OTHER reason)', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.DATA_ENTRY_ERROR,
      voidNote: 'x'.repeat(501),
    });
    expect(props(await validate(dto))).toContain('voidNote');
  });

  it('accepts a non-OTHER reason with a valid optional note', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.WRONG_DATE,
      voidNote: 'keyed against the wrong sheet date',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects reason OTHER with a whitespace-only note (trimmed to empty)', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.OTHER,
      voidNote: '   ',
    });
    expect(props(await validate(dto))).toContain('voidNote');
  });

  it('accepts a non-OTHER reason with an explicit null note (no spurious 400)', async () => {
    const dto = plainToInstance(VoidDeliveryDto, {
      voidReason: DeliveryVoidReason.DATA_ENTRY_ERROR,
      voidNote: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
