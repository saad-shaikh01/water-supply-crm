import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';

/**
 * Transactions written by a Data Import ("Transaction history", reports mode) are normal-looking
 * standalone PAYMENT rows. Editing or deleting one through the payment screens would move the
 * customer's balance, but the history import by design never changed it - so those writes are
 * refused here, in front of (not inside) LedgerService. Reverting the import is the way to remove them.
 *
 * The link is the transaction id recorded in `ImportRow.appliedSnapshot.txIds`; there is
 * deliberately no column on `Transaction`.
 */
@Injectable()
export class ImportedTransactionGuard {
  constructor(private readonly prisma: PrismaService) {}

  async assertNotImported(vendorId: string, transactionId: string): Promise<void> {
    const hit = await this.prisma.importRow.findFirst({
      where: {
        result: 'CREATED',
        entityType: 'Transaction',
        batch: { vendorId },
        appliedSnapshot: { path: ['txIds'], array_contains: transactionId },
      },
      select: { id: true },
    });
    if (hit) {
      throw new ConflictException('This payment comes from an imported history file and cannot be edited or deleted here. Revert the import instead.');
    }
  }
}
