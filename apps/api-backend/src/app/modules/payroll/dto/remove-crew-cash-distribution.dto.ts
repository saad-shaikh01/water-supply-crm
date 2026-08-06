import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * No `version` field — unlike `update`/`approve`, deletion carries no
 * optimistic-concurrency hazard worth guarding (a stale double-delete just
 * hits `NotFoundException` on the second call, not a silently-wrong write).
 * `reason` is optional, matching the doc's "zero ceremony" framing for
 * pre-close fixes (§4/§13) — unlike `VoidStaffLedgerEntryDto.reason`, which
 * is mandatory because voiding a POSTED ledger entry is a bigger event than
 * deleting a same-day, not-yet-synced Crew Cash row.
 */
export class RemoveCrewCashDistributionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
