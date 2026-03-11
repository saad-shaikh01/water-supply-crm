import { apiClient } from '@water-supply-crm/data-access';

export const getProducts = async (params?: { page?: number; limit?: number }) => {
  const response = await apiClient.get('/products', { params });
  return response.data;
};

export const createProduct = async (data: any) => {
  const response = await apiClient.post('/products', data);
  return response.data;
};
