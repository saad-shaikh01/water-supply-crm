import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../../users/api/users.api';

export interface EmployeeIdentity {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive?: boolean;
}

/** Identity (name/role/email) for one employee's Financial Profile header — `GET /users/:id`. */
export const useEmployee = (userId: string) => {
  return useQuery({
    queryKey: ['users', userId],
    queryFn: (): Promise<EmployeeIdentity> => usersApi.getOne(userId).then((r) => r.data),
    enabled: !!userId,
  });
};
