import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@water-supply-crm/database';
import { VendorBrandingModule } from './vendor-branding.module';
import { VendorBrandingService } from './vendor-branding.service';
import { CompanyProfileController, VendorBrandingAdminController } from './vendor-branding.controller';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { REQUIRE_ROLE_KEY } from '../../common/decorators/authz-markers.decorator';

/** Stand-in for the global DatabaseModule so the module graph can be resolved without a database. */
@Global()
@Module({ providers: [{ provide: PrismaService, useValue: {} }], exports: [PrismaService] })
class FakeDatabaseModule {}

describe('VendorBrandingModule wiring', () => {
  it('resolves its whole dependency graph and exports the service globally', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeDatabaseModule, VendorBrandingModule] }).compile();
    expect(moduleRef.get(VendorBrandingService)).toBeInstanceOf(VendorBrandingService);
    expect(moduleRef.get(CompanyProfileController)).toBeDefined();
    expect(moduleRef.get(VendorBrandingAdminController)).toBeDefined();
  });

  it('every vendor-facing route is permission-gated and the platform controller is super-admin only (deny by default)', () => {
    const proto = CompanyProfileController.prototype as unknown as Record<string, unknown>;
    const gated = ['get', 'save', 'preview', 'uploadImage', 'removeImage'].map((m) => Reflect.getMetadata(PERMISSIONS_KEY, proto[m] as object));
    expect(gated.every((g) => Array.isArray(g) ? g.length > 0 : !!g)).toBe(true);
    // updates need company_profile:update, reads need company_profile:view
    expect(JSON.stringify(Reflect.getMetadata(PERMISSIONS_KEY, proto['save'] as object))).toContain('company_profile:update');
    expect(JSON.stringify(Reflect.getMetadata(PERMISSIONS_KEY, proto['uploadImage'] as object))).toContain('company_profile:update');
    expect(JSON.stringify(Reflect.getMetadata(PERMISSIONS_KEY, proto['removeImage'] as object))).toContain('company_profile:update');
    expect(JSON.stringify(Reflect.getMetadata(PERMISSIONS_KEY, proto['get'] as object))).toContain('company_profile:view');
    expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, VendorBrandingAdminController)).toEqual(['SUPER_ADMIN']);
  });
});
