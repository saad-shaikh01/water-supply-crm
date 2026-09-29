import { documentExpiryPhrase, maintenanceDuePhrase } from './fleet-notification.service';

describe('documentExpiryPhrase', () => {
  it('phrases a future expiry in days remaining', () => {
    expect(documentExpiryPhrase(5)).toBe('5 din mein expire ho raha hai');
  });

  it('phrases an expiry today', () => {
    expect(documentExpiryPhrase(0)).toBe('aaj expire ho raha hai');
  });

  it('phrases an already-expired document in days overdue', () => {
    expect(documentExpiryPhrase(-3)).toBe('3 din pehle expire ho chuka hai');
  });
});

describe('maintenanceDuePhrase', () => {
  it('prioritizes km-overdue over days', () => {
    expect(maintenanceDuePhrase(-120, 10)).toBe('120 km se overdue hai');
  });

  it('falls back to days-overdue when km is not overdue', () => {
    expect(maintenanceDuePhrase(500, -2)).toBe('2 din se overdue hai');
  });

  it('phrases km due-soon when neither is overdue', () => {
    expect(maintenanceDuePhrase(250, 20)).toBe('250 km mein due hai');
  });

  it('falls back to days when km is not tracked for this type', () => {
    expect(maintenanceDuePhrase(null, 10)).toBe('10 din mein due hai');
  });

  it('falls back to a generic phrase when neither is tracked', () => {
    expect(maintenanceDuePhrase(null, null)).toBe('due hai');
  });
});
