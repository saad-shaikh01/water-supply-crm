import { apiClient, unwrap } from '../../../lib/api';
import type { PlatformOverview } from '../types';

export const dashboardApi = {
  getPlatformOverview: () => unwrap<PlatformOverview>(apiClient.get('/dashboard/platform')),
};
