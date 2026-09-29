import { usePermissions } from '../authz/hooks/use-permissions';

/** What the current user may do on the Deposits tab. */
export function useDepositPermissions() {
  const { can } = usePermissions();
  return {
    canView: can('customer_deposits:view'),
    canCollect: can('customer_deposits:collect'),
    canRefund: can('customer_deposits:refund'),
    canWriteOff: can('customer_deposits:write_off'),
    canVoid: can('customer_deposits:void'),
    canManageConfig: can('customer_deposits:manage_config'),
  };
}
