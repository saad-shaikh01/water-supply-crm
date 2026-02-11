import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@water-supply-crm/data-access';
import { setCookie, deleteCookie } from 'cookies-next';
import { LoginInput, SignupInput } from '../schemas';
import { useRouter } from 'next/navigation';

export const useLogin = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LoginInput) => {
      const response = await apiClient.post('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      setCookie('auth_token', data.access_token, { maxAge: 60 * 60 * 24 }); // 1 day
      queryClient.setQueryData(['user'], data.user);
      router.push('/dashboard');
    },
  });
};

export const useSignup = () => {
  const router = useRouter();

  return useMutation({
    mutationFn: async (data: SignupInput) => {
      // In our backend, creating a vendor also creates the admin user
      const response = await apiClient.post('/vendors', {
        name: data.vendorName,
        slug: data.vendorSlug,
        adminEmail: data.email,
        adminPassword: data.password,
        adminName: data.name,
      });
      return response.data;
    },
    onSuccess: () => {
      router.push('/auth/login?signup=success');
    },
  });
};

export const useLogout = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  return () => {
    deleteCookie('auth_token');
    queryClient.clear();
    router.push('/auth/login');
  };
};
