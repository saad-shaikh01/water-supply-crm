import { apiClient } from '@water-supply-crm/data-access';

export const getProducts = async () => {
  const response = await apiClient.get('/products');
  return response.data;
};

export const createProduct = async (data: any) => {
  const response = await apiClient.post('/products', data);
  return response.data;
};
