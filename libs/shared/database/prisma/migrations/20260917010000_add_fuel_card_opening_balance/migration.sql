-- Carry-forward baseline for a fuel card's real-world balance at the moment
-- it was registered (e.g. a card that already had cash loaded on it before
-- this feature existed). Included in FuelCardService.computeCardBalance but
-- deliberately NOT a FuelCardTopUp row, so it never touches Office Cash
-- Ledger's available balance.
ALTER TABLE "FuelCard" ADD COLUMN "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
