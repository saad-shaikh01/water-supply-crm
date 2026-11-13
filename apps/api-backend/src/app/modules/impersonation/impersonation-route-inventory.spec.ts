import 'reflect-metadata';
import { BLOCK_WHEN_IMPERSONATING_KEY } from './block-when-impersonating.decorator';
import { UserController } from '../user/user.controller';
import { RolesController } from '../authz/roles.controller';
import { UserAccessController } from '../authz/user-access.controller';
import { ImportController } from '../vendor-import/import.controller';
import { VendorController } from '../vendor/vendor.controller';
import { VendorWipeController } from '../vendor/vendor-wipe.controller';
import { FcmController } from '../fcm/fcm.controller';
import { NotificationPortalController } from '../notifications/notification-portal.controller';
import { SettlementController } from '../payroll/settlement.controller';
import { PlatformImpersonationController } from './impersonation.controller';
import * as wa from '../whatsapp/whatsapp.controller';

/**
 * Route inventory: the exact set of routes refused under an impersonation token. Adding a new
 * dangerous route means consciously adding it here (and to the controller).
 */
function blocked(ctrl: { prototype: object; name: string }): string[] {
  const out: string[] = [];
  const classBlocked = Reflect.getMetadata(BLOCK_WHEN_IMPERSONATING_KEY, ctrl);
  for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
    if (name === 'constructor') continue;
    const fn = (ctrl.prototype as any)[name];
    if (typeof fn !== 'function') continue;
    if (classBlocked || Reflect.getMetadata(BLOCK_WHEN_IMPERSONATING_KEY, fn)) out.push(`${ctrl.name}.${name}`);
  }
  return out.sort();
}

describe('impersonation blocklist route inventory', () => {
  const waCtrls = Object.values(wa).filter((v: any) => typeof v === 'function' && /Controller$/.test(v.name)) as any[];

  it('matches the expected explicit list', () => {
    const actual = [
      UserController, RolesController, UserAccessController, ImportController, VendorController, VendorWipeController,
      FcmController, NotificationPortalController, SettlementController, PlatformImpersonationController, ...waCtrls,
    ].flatMap((c) => blocked(c as never)).sort();

    const expected = [
      'UserController.create', 'UserController.update', 'UserController.deactivate', 'UserController.reactivate',
      'UserController.changePassword', 'UserController.remove',
      'RolesController.create', 'RolesController.update', 'RolesController.remove', 'RolesController.clone', 'RolesController.reset',
      'UserAccessController.assignRole', 'UserAccessController.setOverrides',
      'ImportController.execute', 'ImportController.revert',
      'VendorController.resetAdminPassword', 'VendorController.remove',
      'VendorWipeController.preview', 'VendorWipeController.wipe',
      'FcmController.register', 'FcmController.deleteToken',
      'NotificationPortalController.markAllRead', 'NotificationPortalController.markRead',
      'SettlementController.record', 'SettlementController.markSettled',
      'PlatformImpersonationController.start', 'PlatformImpersonationController.list', 'PlatformImpersonationController.revoke',
    ];
    for (const c of waCtrls) {
      const n = (c as any).name;
      if (n === 'WhatsAppController') expected.push(`${n}.connect`, `${n}.disconnect`);
      else if (n.includes('Platform')) continue;
      else expected.push(`${n}.connect`, `${n}.disconnect`, `${n}.link`, `${n}.importPlatform`);
    }
    expect(actual).toEqual(expected.sort());
  });
});
